/**
 * ABXTAC branded email sender
 *
 * Sends emails as hello@abxtac.com using Gmail API with OAuth.
 * Uses the same Google Workspace credentials as the email-triage system
 * but sends from the ABXTAC alias.
 *
 * Token refresh is automatic via the stored refresh_token.
 */

import { readFileSync } from 'fs';
import path from 'path';

const TOKEN_PATH = path.join(process.cwd(), 'config', 'gmail-token.json');
const SENDER_EMAIL = 'hello@abxtac.com';
const SENDER_NAME = 'ABX TAC';

interface GmailTokenData {
  refresh_token: string;
  token: string;
  client_id: string;
  client_secret: string;
  token_uri: string;
}

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt) {
    return cachedAccessToken;
  }

  const tokenData: GmailTokenData = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));

  const res = await fetch(tokenData.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: tokenData.client_id,
      client_secret: tokenData.client_secret,
      refresh_token: tokenData.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail token refresh failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedAccessToken!;
}

function buildMimeMessage(to: string, subject: string, htmlBody: string): string {
  const boundary = `boundary_${Date.now()}`;
  const lines = [
    `From: ${SENDER_NAME} <${SENDER_EMAIL}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    htmlBody.replace(/<[^>]*>/g, '').replace(/&middot;/g, '·').replace(/&amp;/g, '&'),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    htmlBody,
    ``,
    `--${boundary}--`,
  ];
  return lines.join('\r\n');
}

export async function sendAbxtacEmail(
  to: string,
  subject: string,
  htmlBody: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const accessToken = await getAccessToken();
    const raw = buildMimeMessage(to, subject, htmlBody);
    const encodedMessage = Buffer.from(raw)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedMessage }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[ABXTAC Email] Send failed:', err);
      return { success: false, error: `Gmail API error: ${res.status}` };
    }

    const data = await res.json();
    console.log(`[ABXTAC Email] Sent to ${to}: ${subject} (${data.id})`);
    return { success: true, messageId: data.id };
  } catch (err: any) {
    console.error('[ABXTAC Email] Error:', err.message);
    return { success: false, error: err.message };
  }
}

export function buildBookingConfirmationEmail(params: {
  firstName: string;
  appointmentDate: string;
  appointmentTime: string;
}): { subject: string; html: string } {
  const { firstName, appointmentDate, appointmentTime } = params;

  const subject = `Your ABX TAC Consultation is Confirmed`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <!-- Header -->
    <div style="text-align:center;padding:30px 0;border-bottom:1px solid #1a1a1a;">
      <div style="font-size:28px;font-weight:bold;color:#22c55e;letter-spacing:4px;">ABX TAC</div>
      <div style="font-size:11px;color:#666;letter-spacing:3px;margin-top:8px;text-transform:uppercase;">Peptide Therapy &middot; Lab Testing</div>
    </div>

    <!-- Body -->
    <div style="padding:40px 0;">
      <h1 style="color:#fff;font-size:24px;margin:0 0 20px 0;">Your Consultation is Confirmed</h1>
      <p style="color:#b0b0b0;font-size:16px;line-height:1.6;margin:0 0 30px 0;">
        Hi ${firstName}, your telehealth consultation has been booked. Here are your details:
      </p>

      <!-- Appointment Card -->
      <div style="background:#111;border:1px solid #222;border-radius:12px;padding:24px;margin:0 0 30px 0;">
        <div style="font-size:11px;color:#22c55e;letter-spacing:2px;text-transform:uppercase;margin-bottom:16px;">Appointment Details</div>
        <div style="display:flex;margin-bottom:12px;">
          <div style="color:#666;width:80px;font-size:14px;">Date</div>
          <div style="color:#fff;font-size:14px;font-weight:600;">${appointmentDate}</div>
        </div>
        <div style="display:flex;margin-bottom:12px;">
          <div style="color:#666;width:80px;font-size:14px;">Time</div>
          <div style="color:#fff;font-size:14px;font-weight:600;">${appointmentTime} (Arizona Time)</div>
        </div>
        <div style="display:flex;margin-bottom:12px;">
          <div style="color:#666;width:80px;font-size:14px;">Type</div>
          <div style="color:#fff;font-size:14px;">Telehealth Video Call</div>
        </div>
        <div style="display:flex;">
          <div style="color:#666;width:80px;font-size:14px;">Cost</div>
          <div style="color:#22c55e;font-size:14px;font-weight:600;">$99.00 (paid)</div>
        </div>
      </div>

      <!-- What to Expect -->
      <div style="margin:0 0 30px 0;">
        <h2 style="color:#fff;font-size:18px;margin:0 0 16px 0;">What to Expect</h2>
        <div style="color:#b0b0b0;font-size:14px;line-height:1.8;">
          <p style="margin:0 0 8px 0;">1. You'll receive a separate video call link before your appointment.</p>
          <p style="margin:0 0 8px 0;">2. Your provider will review your health goals and medical history.</p>
          <p style="margin:0 0 8px 0;">3. Together, you'll design a personalized peptide protocol.</p>
          <p style="margin:0;">4. After your visit, you'll have access to our peptide catalog and BioBox lab kits at member pricing.</p>
        </div>
      </div>

      <!-- CTA -->
      <div style="text-align:center;padding:20px 0;">
        <a href="https://abxtac.com/shop" style="display:inline-block;background:#22c55e;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:1px;">
          Browse Our Catalog
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid #1a1a1a;padding:24px 0;text-align:center;">
      <p style="color:#444;font-size:12px;margin:0 0 8px 0;">
        ABX TAC &middot; Doctor-Supervised Peptide Therapy
      </p>
      <p style="color:#333;font-size:11px;margin:0;">
        Questions? Reply to this email or visit <a href="https://abxtac.com" style="color:#22c55e;text-decoration:none;">abxtac.com</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}
