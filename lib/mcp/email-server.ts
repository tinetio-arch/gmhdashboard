/**
 * Email MCP Server
 * Exposes AWS SES email sending as MCP tools for agentic AI
 * 
 * This allows the AI agent to send emails via AWS SES
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export interface EmailMCPServerConfig {
  sesClient?: SESClient;
  defaultSender?: string;
}

function getSesClient(): SESClient | null {
  const region = process.env.AWS_SES_REGION ?? process.env.AWS_REGION ?? process.env.SES_REGION;
  if (!region) {
    return null;
  }
  return new SESClient({ region });
}

export function createEmailMCPServer(config?: EmailMCPServerConfig) {
  const server = new Server({
    name: 'email-service',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
    },
  });

  const sesClient = config?.sesClient || getSesClient();
  const defaultSender = config?.defaultSender || process.env.SES_SENDER || process.env.INVENTORY_ALERT_SENDER;

  if (!sesClient) {
    throw new Error('AWS SES not configured. Set AWS_SES_REGION or AWS_REGION environment variable.');
  }

  if (!defaultSender) {
    throw new Error('Email sender not configured. Set SES_SENDER or INVENTORY_ALERT_SENDER environment variable.');
  }

  // Tool: Send email
  server.setRequestHandler('tools/list', async () => ({
    tools: [
      {
        name: 'send_email',
        description: 'Send an email via AWS SES. Returns success status.',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Recipient email address',
            },
            subject: {
              type: 'string',
              description: 'Email subject line',
            },
            body: {
              type: 'string',
              description: 'Email body (plain text)',
            },
            html_body: {
              type: 'string',
              description: 'Email body (HTML, optional)',
            },
            from: {
              type: 'string',
              description: 'Sender email address (optional, uses default if not provided)',
            },
          },
          required: ['to', 'subject', 'body'],
        },
      },
      {
        name: 'send_patient_labs_email',
        description: 'Send a formatted email to a patient with their lab results. Automatically formats the email with patient name and lab data.',
        inputSchema: {
          type: 'object',
          properties: {
            patient_email: {
              type: 'string',
              description: 'Patient email address',
            },
            patient_name: {
              type: 'string',
              description: 'Patient full name',
            },
            lab_data: {
              type: 'object',
              description: 'Lab results data (JSON object)',
            },
          },
          required: ['patient_email', 'patient_name', 'lab_data'],
        },
      },
    ],
  }));

  // Tool execution handler
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'send_email': {
          const { to, subject, body, html_body, from } = args as {
            to: string;
            subject: string;
            body: string;
            html_body?: string;
            from?: string;
          };

          const sender = from || defaultSender!;

          const command = new SendEmailCommand({
            Source: sender,
            Destination: { ToAddresses: [to] },
            Message: {
              Subject: { Data: subject },
              Body: {
                Text: { Data: body },
                ...(html_body ? { Html: { Data: html_body } } : {}),
              },
            },
          });

          const result = await sesClient.send(command);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message_id: result.MessageId,
                  to,
                  subject,
                }, null, 2),
              },
            ],
          };
        }

        case 'send_patient_labs_email': {
          const { patient_email, patient_name, lab_data } = args as {
            patient_email: string;
            patient_name: string;
            lab_data: any;
          };

          // Format email with lab results
          const subject = `Lab Results - ${patient_name}`;
          
          let body = `Dear ${patient_name},\n\n`;
          body += `Please find your lab results below:\n\n`;
          
          if (lab_data.last_lab) {
            body += `Last Lab Date: ${lab_data.last_lab}\n`;
          }
          if (lab_data.next_lab) {
            body += `Next Lab Due: ${lab_data.next_lab}\n`;
          }
          if (lab_data.lab_status) {
            body += `Status: ${lab_data.lab_status}\n`;
          }
          if (lab_data.lab_notes) {
            body += `\nNotes: ${lab_data.lab_notes}\n`;
          }

          body += `\nIf you have any questions, please contact our office.\n\n`;
          body += `Best regards,\nYour Healthcare Team`;

          // HTML version
          const htmlBody = `
            <html>
              <body>
                <p>Dear ${patient_name},</p>
                <p>Please find your lab results below:</p>
                <ul>
                  ${lab_data.last_lab ? `<li><strong>Last Lab Date:</strong> ${lab_data.last_lab}</li>` : ''}
                  ${lab_data.next_lab ? `<li><strong>Next Lab Due:</strong> ${lab_data.next_lab}</li>` : ''}
                  ${lab_data.lab_status ? `<li><strong>Status:</strong> ${lab_data.lab_status}</li>` : ''}
                </ul>
                ${lab_data.lab_notes ? `<p><strong>Notes:</strong> ${lab_data.lab_notes}</p>` : ''}
                <p>If you have any questions, please contact our office.</p>
                <p>Best regards,<br>Your Healthcare Team</p>
              </body>
            </html>
          `;

          const command = new SendEmailCommand({
            Source: defaultSender!,
            Destination: { ToAddresses: [patient_email] },
            Message: {
              Subject: { Data: subject },
              Body: {
                Text: { Data: body },
                Html: { Data: htmlBody },
              },
            },
          });

          const result = await sesClient.send(command);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message_id: result.MessageId,
                  to: patient_email,
                  patient_name,
                  subject,
                }, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}


