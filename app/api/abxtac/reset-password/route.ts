/**
 * ABXTAC — Public Password Reset (brand-owned, fully branded email)
 *
 * Flow: User clicks "Reset password" in an ABXTAC email → lands on
 *   https://abxtac.com/reset-password → submits email.
 *
 * This endpoint:
 *   1. Looks up the active Healthie patient by email
 *   2. Generates a secure temporary password
 *   3. Sets it on the Healthie account via updateClient (admin)
 *   4. Sends an ABXTAC-branded email via GHL with the temp password
 *
 * No Healthie branded email is sent. Always returns success to prevent
 * account enumeration.
 *
 * CORS-restricted to https://abxtac.com.
 */

import { NextRequest, NextResponse } from 'next/server';
import { healthieGraphQL } from '@/lib/healthieApi';
import { createGHLClientForABXTAC } from '@/lib/ghl';
import { query } from '@/lib/db';
import crypto from 'crypto';

async function logNeedsDecision(summary: string, detail: Record<string, unknown>) {
  try {
    await query(
      `INSERT INTO agent_action_log (agent_name, action_type, category, summary, details, status)
       VALUES ($1, 'needs_decision', 'patient_access', $2, $3::jsonb, 'needs_decision')`,
      ['abxtac_password_reset', summary, JSON.stringify(detail)]
    );
  } catch (err) {
    console.error('[abxtac/reset-password][ALERT] agent_action_log insert failed:', err, detail);
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://abxtac.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SUCCESS_RESPONSE = {
  success: true,
  message: 'If an account exists for this email, a new password has been sent.',
};

const OK = (body: unknown = SUCCESS_RESPONSE, status = 200) =>
  NextResponse.json(body, { status, headers: CORS_HEADERS });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function generateTempPassword(length = 12): string {
  // Avoid ambiguous chars (O/0, I/l/1). Mix case + digit guarantees complexity.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function brandedPasswordEmailHtml(opts: { firstName: string; tempPassword: string }) {
  const { firstName, tempPassword } = opts;
  const open = 'https://abxtac.com/open-app';
  const iosUrl = 'https://apps.apple.com/us/app/now-optimal/id6759345635';
  const androidUrl = 'https://play.google.com/store/apps/details?id=com.nowoptimal.patient';
  const appIcon = 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/84/ec/22/84ec2226-394d-82e1-8255-d91319d8245e/AppIcon-0-0-1x_U007epad-0-1-85-220.png/512x512bb.jpg';
  const logo = 'https://abxtac.com/abxtac-logo-white.png';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Your ABXTAC password has been reset</title>
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  body{margin:0!important;padding:0!important;width:100%!important;background:#0a0a0a;font-family:'Inter',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#1f2937}
  img{border:0;outline:none;text-decoration:none;display:block}
  @media only screen and (max-width:620px){
    .container{width:100%!important;max-width:100%!important;border-radius:0!important}
    .px-32{padding-left:22px!important;padding-right:22px!important}
    .app-pad{padding:36px 22px!important}
    .badge-td{display:block!important;padding:8px 0!important;text-align:center!important}
  }
</style></head>
<body style="margin:0;padding:0;background:#0a0a0a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f4;">
 <tr><td align="center" style="padding:20px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container" style="width:600px;max-width:600px;background:#ffffff;border-radius:4px;overflow:hidden;">
   <tr><td align="center" style="background:#0a0a0a;padding:40px 24px;">
    <img src="${logo}" alt="ABXTAC" width="260" style="max-width:260px;height:auto;margin:0 auto;">
    <div style="color:#22c55e;font-size:12px;letter-spacing:0.28em;margin-top:14px;text-transform:uppercase;font-weight:700;">Peptide Therapy</div>
   </td></tr>
   <tr><td style="background:#22c55e;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>

   <tr><td class="px-32" style="padding:40px 48px 12px 48px;">
    <h1 style="font-size:30px;line-height:1.2;color:#0a0a0a;margin:0 0 18px 0;letter-spacing:-0.02em;font-weight:700;">Your password has been reset</h1>
    <p style="margin:0 0 14px 0;font-size:16px;line-height:1.6;color:#1f2937;">Hi ${firstName || 'there'}, here's your new ABXTAC password. Use it to log in to the <strong>Now Optimal</strong> app, then change it to something memorable under your profile.</p>
   </td></tr>

   <tr><td class="px-32" style="padding:8px 48px 24px 48px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F4FBF6;border-left:4px solid #22c55e;border-radius:4px;">
     <tr><td style="padding:22px 24px;">
      <div style="font-size:12px;font-weight:700;color:#22c55e;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:10px;">Temporary Password</div>
      <div style="font-family:'SFMono-Regular',Menlo,monospace;font-size:22px;font-weight:700;color:#0a0a0a;letter-spacing:0.04em;word-break:break-all;">${tempPassword}</div>
      <div style="font-size:13px;color:#4b5563;margin-top:10px;">Case-sensitive. Please change it after you log in.</div>
     </td></tr>
    </table>
   </td></tr>

   <tr><td style="background:#0a0a0a;padding:0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td class="app-pad" align="center" style="padding:44px 48px;">
     <img src="${appIcon}" alt="Now Optimal" width="96" height="96" style="width:96px;height:96px;border-radius:22px;display:block;margin:0 auto 22px auto;border:1px solid #1f2937;">
     <div style="color:#22c55e;font-size:11px;letter-spacing:0.28em;margin-bottom:10px;font-weight:700;text-transform:uppercase;">Now Optimal</div>
     <h2 style="color:#ffffff;font-size:26px;line-height:1.25;margin:0 0 14px 0;font-weight:700;">Log in to the app</h2>
     <p style="color:#cbd5e1;font-size:16px;line-height:1.6;margin:0 auto 26px auto;max-width:440px;text-align:center;">Use the email on file and the temporary password above.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
      <td align="center" bgcolor="#22c55e" style="border-radius:999px;">
       <a href="${open}" style="background:#22c55e;color:#0a0a0a!important;font-weight:700;font-size:17px;padding:16px 38px;border-radius:999px;display:inline-block;text-decoration:none;letter-spacing:0.02em;">Open the Now Optimal App &rarr;</a>
      </td>
     </tr></table>
     <div style="color:#64748b;font-size:12px;margin:18px 0 18px 0;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;">Don't have the app yet?</div>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
      <td class="badge-td" style="padding:0 6px;"><a href="${iosUrl}"><img src="https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/en-us?size=250x83" alt="Download on the App Store" width="160" style="height:auto;max-width:160px;display:block;border-radius:8px;"></a></td>
      <td class="badge-td" style="padding:0 6px;"><a href="${androidUrl}"><img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" alt="Get it on Google Play" width="180" style="height:auto;max-width:180px;display:block;"></a></td>
     </tr></table>
    </td></tr></table>
   </td></tr>

   <tr><td class="px-32" style="padding:30px 48px 34px 48px;background:#ffffff;">
    <h2 style="font-size:18px;line-height:1.3;color:#0a0a0a;margin:0 0 8px 0;">Didn't request this?</h2>
    <p style="margin:0;font-size:15px;color:#4b5563;">If you didn't ask for a password reset, please reply to this email and we'll secure your account. Or call <a href="tel:9282122772" style="font-weight:700;color:#22c55e;">928-212-2772</a>.</p>
   </td></tr>

   <tr><td align="center" style="background:#0a0a0a;padding:36px 24px;">
    <img src="${logo}" alt="ABXTAC" width="200" style="max-width:200px;height:auto;margin:0 auto 16px auto;">
    <div style="color:#22c55e;font-size:11px;letter-spacing:0.28em;font-weight:700;text-transform:uppercase;margin-bottom:20px;">Heal &middot; Optimize &middot; Thrive</div>
    <div style="color:#9ca3af;font-size:12px;line-height:1.7;"><a href="https://abxtac.com" style="color:#4ADE80;">abxtac.com</a> &nbsp;&middot;&nbsp; <a href="tel:9282122772" style="color:#4ADE80;">928-212-2772</a></div>
   </td></tr>
  </table>
 </td></tr>
</table>
</body></html>`;
}

async function lookupHealthiePatient(email: string): Promise<{ id: string; firstName: string } | null> {
  try {
    const data = await healthieGraphQL<{
      users: Array<{ id: string; first_name: string; last_name: string; email: string | null; active: boolean }>;
    }>(`
      query SearchPatient($keywords: String) {
        users(keywords: $keywords, active_status: "Active") { id first_name last_name email active }
      }
    `, { keywords: email });
    const match = (data.users || []).find(
      u => (u.email || '').toLowerCase() === email.toLowerCase() && u.active
    );
    return match ? { id: match.id, firstName: match.first_name || '' } : null;
  } catch (err) {
    console.error('[abxtac/reset-password] Healthie lookup failed:', err);
    return null;
  }
}

async function setHealthiePassword(healthieId: string, password: string): Promise<boolean> {
  try {
    const data = await healthieGraphQL<{
      updateClient: { user: { id: string } | null; messages: Array<{ message: string }> };
    }>(`
      mutation UpdateClientPassword($input: updateClientInput!) {
        updateClient(input: $input) { user { id } messages { message } }
      }
    `, { input: { id: healthieId, password } });
    const messages = data.updateClient?.messages || [];
    if (messages.length > 0) {
      console.error('[abxtac/reset-password] Healthie updateClient messages:', messages);
      return false;
    }
    return !!data.updateClient?.user?.id;
  } catch (err) {
    console.error('[abxtac/reset-password] Healthie updateClient failed:', err);
    return false;
  }
}

async function sendBrandedResetEmail(email: string, firstName: string, tempPassword: string): Promise<boolean> {
  const ghl = createGHLClientForABXTAC();
  const apiKey = process.env.GHL_ABXTAC_API_KEY;
  const locationId = process.env.GHL_ABXTAC_LOCATION_ID || 'OyC2MESFDP3Pxm10tECz';
  if (!ghl || !apiKey) {
    console.error('[abxtac/reset-password] GHL ABXTAC client unavailable');
    return false;
  }
  try {
    let contact = await ghl.findContactByEmail(email);
    if (!contact) {
      contact = await ghl.createContact({
        email,
        firstName: firstName || undefined,
        locationId,
        tags: ['abxtac-password-reset'],
      } as any);
    }
    const contactId = contact?.id;
    if (!contactId) {
      console.error('[abxtac/reset-password] GHL contact has no id');
      return false;
    }

    const html = brandedPasswordEmailHtml({ firstName, tempPassword });
    const resp = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'Email',
        contactId,
        emailTo: email,
        subject: 'Your new ABXTAC password',
        html,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[abxtac/reset-password] GHL send email HTTP ${resp.status}: ${text}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[abxtac/reset-password] GHL email send failed:', err);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = (body?.email || '').toString().trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return OK({ success: false, error: 'Valid email is required' }, 400);
    }

    const patient = await lookupHealthiePatient(email);

    if (!patient) {
      console.log(`[abxtac/reset-password] no active Healthie match for ${email} (silent success)`);
      return OK();
    }

    const tempPassword = generateTempPassword(12);
    const setOk = await setHealthiePassword(patient.id, tempPassword);
    if (!setOk) {
      console.error(`[abxtac/reset-password][ALERT] Healthie password set FAILED for ${email} (${patient.id}); no email sent`);
      await logNeedsDecision('ABXTAC password reset failed at Healthie — patient NOT locked out, but reset did not complete.', {
        email,
        healthieId: patient.id,
        firstName: patient.firstName,
        stage: 'set_password',
      });
      return OK();
    }

    const emailOk = await sendBrandedResetEmail(email, patient.firstName, tempPassword);
    if (!emailOk) {
      console.error(`[abxtac/reset-password][ALERT] Password CHANGED but email send FAILED for ${email} (${patient.id}) — patient is locked out`);
      await logNeedsDecision('ABXTAC password was changed in Healthie but the email failed to send. Patient is LOCKED OUT — contact them now.', {
        email,
        healthieId: patient.id,
        firstName: patient.firstName,
        tempPassword,
        stage: 'send_email',
      });
    } else {
      console.log(`[abxtac/reset-password] reset complete for ${email} (${patient.id})`);
    }
    return OK();
  } catch (error) {
    console.error('[abxtac/reset-password] unhandled error:', error);
    return OK();
  }
}
