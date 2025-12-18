import { randomUUID } from 'crypto';

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

import { auditService } from './audit';
import { createGHLClient } from './ghl';
import { patientsService, PatientProfile } from './patients';

/**
 * Messaging domain module
 * -----------------------
 * Bridges GoHighLevel (SMS) and auxiliary channels so we can send consistent
 * patient communications with audit logging.
 */

export type MessageChannel = 'sms' | 'email';

export type MessageTemplate = {
  channel: MessageChannel;
  templateId?: string;
  subject?: string;
  body?: string;
  variables?: Record<string, string | number | boolean>;
  senderEmail?: string;
  senderName?: string;
};

export type MessageReceipt = {
  id: string;
  patientId: string;
  channel: MessageChannel;
  status: 'queued' | 'sent' | 'failed';
  providerMessageId?: string;
  failureReason?: string;
};

export type BroadcastOptions = {
  previewOnly?: boolean;
  maxPreview?: number;
  actorId?: string;
};

export type BroadcastPreviewEntry = {
  patientId: string;
  channel: MessageChannel;
  destination: string;
  subject?: string;
  body: string;
};

export type BroadcastFailure = {
  patientId: string;
  reason: string;
};

export interface MessagingService {
  sendPatientMessage(patientId: string, payload: MessageTemplate): Promise<MessageReceipt>;
  broadcast(
    patientIds: string[],
    payload: MessageTemplate,
    options?: BroadcastOptions
  ): Promise<{ preview: BroadcastPreviewEntry[] } | { results: MessageReceipt[]; failures: BroadcastFailure[] }>;
}

const DEFAULT_PREVIEW_LIMIT = 5;

function requireBody(payload: MessageTemplate): string {
  const body = payload.body?.trim();
  if (body) {
    return body;
  }
  throw new Error('Message body is required.');
}

function requireSubject(payload: MessageTemplate): string {
  const subject = payload.subject?.trim();
  if (subject) {
    return subject;
  }
  throw new Error('Message subject is required for email messages.');
}

async function resolveGhlContactId(patientId: string, existingId?: string | null): Promise<string> {
  if (existingId) {
    return existingId;
  }
  return patientsService.ensureGhlContact(patientId);
}

function formatPhonePreview(phone?: string | null): string {
  if (!phone) {
    return 'no-phone';
  }
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function normalizeVariables(payload: MessageTemplate): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (payload.variables) {
    for (const [key, value] of Object.entries(payload.variables)) {
      normalized[key] = typeof value === 'string' ? value : String(value);
    }
  }
  return normalized;
}

function buildTemplateContext(patient: PatientProfile, payload: MessageTemplate): Record<string, string> {
  const [firstName = patient.fullName ?? '', ...rest] = patient.fullName?.split(' ') ?? [''];
  const lastName = rest.join(' ').trim();
  return {
    patientId: patient.patientId,
    patientName: patient.fullName,
    patientFirstName: firstName,
    patientLastName: lastName || '',
    email: patient.email ?? '',
    phone: patient.phone ?? '',
    ...normalizeVariables(payload),
  };
}

function interpolate(template: string | undefined, context: Record<string, string>): string {
  if (!template) {
    return '';
  }
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => context[key] ?? '');
}

let sesClient: SESClient | null = null;

function getSesClient(): SESClient {
  if (sesClient) {
    return sesClient;
  }
  const region = process.env.AWS_SES_REGION ?? process.env.AWS_REGION ?? process.env.SES_REGION;
  if (!region) {
    throw new Error('AWS SES region is not configured. Set AWS_SES_REGION or AWS_REGION.');
  }
  sesClient = new SESClient({ region });
  return sesClient;
}

function resolveEmailSender(payload?: MessageTemplate): string {
  if (payload?.senderEmail) {
    return payload.senderName ? `${payload.senderName} <${payload.senderEmail}>` : payload.senderEmail;
  }
  const sender =
    process.env.SES_SENDER ??
    process.env.INVENTORY_ALERT_SENDER ??
    process.env.ALERT_SENDER;
  if (!sender) {
    throw new Error('Email sender is not configured. Set SES_SENDER (or INVENTORY_ALERT_SENDER).');
  }
  return sender;
}

async function sendEmailMessage(to: string, subject: string, body: string, payload?: MessageTemplate): Promise<string | undefined> {
  const sender = resolveEmailSender(payload);
  const client = getSesClient();
  const command = new SendEmailCommand({
    Source: sender,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject },
      Body: {
        Text: { Data: body },
      },
    },
  });
  const response = await client.send(command);
  return response.MessageId;
}

function resolveActorId(payloadActor?: string, fallback?: string): string {
  if (payloadActor && payloadActor.trim()) {
    return payloadActor.trim();
  }
  if (fallback && fallback.trim()) {
    return fallback.trim();
  }
  return 'system';
}

export const messagingService: MessagingService = {
  async sendPatientMessage(patientId, payload) {
    const patient = await patientsService.getById(patientId);
    if (!patient) {
      throw new Error(`Patient ${patientId} not found.`);
    }

    const context = buildTemplateContext(patient, payload);
    const actorFromTemplate = typeof payload.variables?.actorId === 'string' ? payload.variables.actorId : undefined;
    const actorId = resolveActorId(actorFromTemplate);

    if (payload.channel === 'sms') {
      const ghlClient = createGHLClient();
      if (!ghlClient) {
        throw new Error('GHL client is not configured.');
      }
      const body = interpolate(requireBody(payload), context).trim();
      const contactId = await resolveGhlContactId(patientId, patient.ghlContactId);
      const response = await ghlClient.sendSms(contactId, body);

      const receipt: MessageReceipt = {
        id: response?.id ?? randomUUID(),
        patientId,
        channel: 'sms',
        status: 'sent',
        providerMessageId: response?.id,
      };

      await auditService.logEvent({
        actorId,
        patientId,
        system: 'GHL',
        action: 'MESSAGE_SMS_SENT',
        payload: { receipt, body },
      });

      return receipt;
    }

    if (payload.channel === 'email') {
      const email = patient.email;
      if (!email) {
        throw new Error(`Patient ${patientId} does not have an email address on file.`);
      }
      const subject = interpolate(requireSubject(payload), context);
      const body = interpolate(requireBody(payload), context);
      const providerMessageId = await sendEmailMessage(email, subject, body, payload);

      const receipt: MessageReceipt = {
        id: providerMessageId ?? randomUUID(),
        patientId,
        channel: 'email',
        status: 'sent',
        providerMessageId,
      };

      await auditService.logEvent({
        actorId,
        patientId,
        system: 'EMAIL',
        action: 'MESSAGE_EMAIL_SENT',
        payload: { receipt, subject },
      });

      return receipt;
    }

    throw new Error(`Unsupported messaging channel: ${payload.channel}`);
  },

  async broadcast(patientIds, payload, options = {}) {
    const uniqueIds = Array.from(new Set(patientIds));
    if (uniqueIds.length === 0) {
      throw new Error('At least one patientId is required for broadcast.');
    }

    const ghlClient = payload.channel === 'sms' ? createGHLClient() : null;
    if (payload.channel === 'sms' && !ghlClient) {
      throw new Error('GHL client is not configured.');
    }

    const actorFromTemplate = typeof payload.variables?.actorId === 'string' ? payload.variables.actorId : undefined;
    const actorId = resolveActorId(actorFromTemplate, options.actorId);

    const previews: BroadcastPreviewEntry[] = [];
    const receipts: MessageReceipt[] = [];
    const failures: BroadcastFailure[] = [];
    const previewLimit = options.maxPreview ?? DEFAULT_PREVIEW_LIMIT;

    for (const patientId of uniqueIds) {
      let patient: PatientProfile | null = null;
      try {
        patient = await patientsService.getById(patientId);
        if (!patient) {
          throw new Error('Patient not found.');
        }
      } catch (error) {
        failures.push({
          patientId,
          reason: error instanceof Error ? error.message : String(error),
        });
        if (options.previewOnly && previews.length >= previewLimit) {
          break;
        }
        continue;
      }

      const context = buildTemplateContext(patient, payload);
      const body = interpolate(requireBody(payload), context).trim();
      const subject = payload.channel === 'email' ? interpolate(requireSubject(payload), context) : undefined;

      if (options.previewOnly) {
        const destination =
          payload.channel === 'sms'
            ? formatPhonePreview(patient.phone) || `contact:${patient.ghlContactId ?? 'unknown'}`
            : patient.email ?? 'no-email';
        previews.push({
          patientId,
          channel: payload.channel,
          destination,
          subject,
          body,
        });
        if (previews.length >= previewLimit) {
          break;
        }
        continue;
      }

      try {
        if (payload.channel === 'sms') {
          const contactId = await resolveGhlContactId(patientId, patient.ghlContactId);
          const response = await ghlClient!.sendSms(contactId, body);
          const receipt: MessageReceipt = {
            id: response?.id ?? randomUUID(),
            patientId,
            channel: 'sms',
            status: 'sent',
            providerMessageId: response?.id,
          };
          receipts.push(receipt);
          await auditService.logEvent({
            actorId,
            patientId,
            system: 'GHL',
            action: 'MESSAGE_SMS_SENT',
            payload: { receipt, body, broadcast: true },
          });
        } else if (payload.channel === 'email') {
          if (!patient.email) {
            throw new Error('Missing patient email.');
          }
          const providerMessageId = await sendEmailMessage(patient.email, subject ?? '', body, payload);
          const receipt: MessageReceipt = {
            id: providerMessageId ?? randomUUID(),
            patientId,
            channel: 'email',
            status: 'sent',
            providerMessageId,
          };
          receipts.push(receipt);
          await auditService.logEvent({
            actorId,
            patientId,
            system: 'EMAIL',
            action: 'MESSAGE_EMAIL_SENT',
            payload: { receipt, subject, broadcast: true },
          });
        } else {
          throw new Error(`Unsupported messaging channel: ${payload.channel}`);
        }
      } catch (error) {
        failures.push({
          patientId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (options.previewOnly) {
      return { preview: previews };
    }

    return { results: receipts, failures };
  },
};

