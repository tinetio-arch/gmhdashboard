import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

let sesClient: SESClient | null = null;

function getSesClient(): SESClient | null {
  if (sesClient) {
    return sesClient;
  }
  const region = process.env.AWS_SES_REGION ?? process.env.AWS_REGION ?? process.env.SES_REGION;
  if (!region) {
    return null;
  }
  sesClient = new SESClient({ region });
  return sesClient;
}

export async function sendInventoryAlert({
  vendor,
  available,
  total,
  threshold
}: {
  vendor: string;
  available: number;
  total: number;
  threshold: number;
}): Promise<void> {
  const recipientsEnv = process.env.INVENTORY_ALERT_RECIPIENTS ?? process.env.ADMIN_ALERT_RECIPIENTS;
  const sender = process.env.INVENTORY_ALERT_SENDER ?? process.env.SES_SENDER ?? process.env.ALERT_SENDER;
  if (!recipientsEnv || !sender) {
    console.warn('Inventory alert skipped: recipients or sender not configured.', { vendor, available });
    return;
  }
  const recipients = recipientsEnv.split(',').map((email) => email.trim()).filter(Boolean);
  if (recipients.length === 0) {
    console.warn('Inventory alert skipped: no valid recipients.', { vendor, available });
    return;
  }

  const client = getSesClient();
  if (!client) {
    console.warn('Inventory alert skipped: SES region not configured.', { vendor, available });
    return;
  }

  const subject = `Low testosterone inventory: ${vendor} (${available} vials)`;
  const body = `Inventory alert\n\nVendor: ${vendor}\nAvailable vials: ${available}\nTotal vials (all statuses): ${total}\nThreshold: ${threshold}\n\nPlease receive additional stock immediately.`;

  try {
    await client.send(
      new SendEmailCommand({
        Source: sender,
        Destination: { ToAddresses: recipients },
        Message: {
          Subject: { Data: subject },
          Body: {
            Text: { Data: body }
          }
        }
      })
    );
  } catch (error) {
    console.error('Failed to deliver inventory alert', error);
  }
}


