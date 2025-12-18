/**
 * GoHighLevel (GHL) MCP Server
 * Exposes GHL API as MCP tools for agentic AI
 * 
 * This allows the AI agent to interact with GoHighLevel CRM
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { GHLClient, createGHLClient } from '../ghl';

export interface GHLMCPServerConfig {
  ghlClient?: GHLClient;
}

export function createGHLMCPServer(config?: GHLMCPServerConfig) {
  const server = new Server({
    name: 'ghl-api',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
    },
  });

  const ghlClient = config?.ghlClient || createGHLClient();

  if (!ghlClient) {
    throw new Error('GHL client not configured. Set GHL_API_KEY and GHL_LOCATION_ID environment variables.');
  }

  // Tool: Get contact information
  server.setRequestHandler('tools/list', async () => ({
    tools: [
      {
        name: 'get_contact',
        description: 'Get contact information from GoHighLevel by email or phone',
        inputSchema: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              description: 'Contact email address',
            },
            phone: {
              type: 'string',
              description: 'Contact phone number',
            },
          },
        },
      },
      {
        name: 'search_contacts',
        description: 'Search for contacts in GoHighLevel by name or other criteria',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (name, email, phone, etc.)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_contact_communication',
        description: 'Get communication history for a contact (calls, texts, emails)',
        inputSchema: {
          type: 'object',
          properties: {
            contact_id: {
              type: 'string',
              description: 'GHL contact ID',
            },
          },
          required: ['contact_id'],
        },
      },
      {
        name: 'send_sms',
        description: 'Send SMS message to a contact via GoHighLevel',
        inputSchema: {
          type: 'object',
          properties: {
            contact_id: {
              type: 'string',
              description: 'GHL contact ID',
            },
            message: {
              type: 'string',
              description: 'Message text to send',
            },
          },
          required: ['contact_id', 'message'],
        },
      },
      {
        name: 'schedule_appointment',
        description: 'Schedule an appointment for a contact in GoHighLevel',
        inputSchema: {
          type: 'object',
          properties: {
            contact_id: {
              type: 'string',
              description: 'GHL contact ID',
            },
            date: {
              type: 'string',
              description: 'Appointment date (ISO format)',
            },
            time: {
              type: 'string',
              description: 'Appointment time',
            },
            notes: {
              type: 'string',
              description: 'Appointment notes',
            },
          },
          required: ['contact_id', 'date', 'time'],
        },
      },
    ],
  }));

  // Tool execution handler
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'get_contact': {
          const { email, phone } = args as { email?: string; phone?: string };

          // Note: You'll need to implement these methods in your GHL client
          // This is a template showing what the structure should be
          
          let contact = null;
          if (email) {
            // contact = await ghlClient.getContactByEmail(email);
          } else if (phone) {
            // contact = await ghlClient.getContactByPhone(phone);
          }

          if (!contact) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Contact not found in GoHighLevel',
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(contact, null, 2),
              },
            ],
          };
        }

        case 'search_contacts': {
          const { query } = args as { query: string };

          // contacts = await ghlClient.searchContacts(query);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: 'GHL contact search - implementation needed',
                  query,
                }, null, 2),
              },
            ],
          };
        }

        case 'get_contact_communication': {
          const { contact_id } = args as { contact_id: string };

          // const communications = await ghlClient.getContactCommunications(contact_id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: 'GHL communication history - implementation needed',
                  contact_id,
                }, null, 2),
              },
            ],
          };
        }

        case 'send_sms': {
          const { contact_id, message } = args as { contact_id: string; message: string };

          // const result = await ghlClient.sendSMS(contact_id, message);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: 'SMS sent (implementation needed)',
                  contact_id,
                }, null, 2),
              },
            ],
          };
        }

        case 'schedule_appointment': {
          const { contact_id, date, time, notes } = args as {
            contact_id: string;
            date: string;
            time: string;
            notes?: string;
          };

          // const appointment = await ghlClient.scheduleAppointment({
          //   contact_id,
          //   date,
          //   time,
          //   notes,
          // });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: 'Appointment scheduled (implementation needed)',
                  contact_id,
                  date,
                  time,
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


