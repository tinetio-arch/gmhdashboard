import fetch from 'node-fetch';

export type ChatCardSection = {
  header?: string;
  items: Array<{ key: string; value: string | number | null | undefined }>;
};

export type ChatMessage = {
  text: string;
  cardSections?: ChatCardSection[];
};

function buildCardPayload(sections: ChatCardSection[]) {
  return {
    cardsV2: [
      {
        cardId: 'ops-alert',
        card: {
          sections: sections.map((section) => ({
            header: section.header,
            collapsible: false,
            widgets: section.items.map((item) => ({
              keyValue: {
                topLabel: item.key,
                content: item.value == null ? '' : String(item.value),
                contentMultiline: true,
              },
            })),
          })),
        },
      },
    ],
  };
}

export async function sendChatMessage(webhookUrl: string | undefined, message: ChatMessage) {
  if (!webhookUrl) return;
  const payload: Record<string, unknown> = { text: message.text };
  if (message.cardSections?.length) {
    Object.assign(payload, buildCardPayload(message.cardSections));
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  });
}
