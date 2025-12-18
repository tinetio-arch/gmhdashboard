/**
 * Healthie MCP Server
 * Exposes Healthie API as MCP tools for agentic AI
 * 
 * This allows the AI agent to interact with Healthie EMR
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { HealthieClient, createHealthieClient } from '../healthie';

export interface HealthieMCPServerConfig {
  healthieClient?: HealthieClient;
}

export function createHealthieMCPServer(config?: HealthieMCPServerConfig) {
  const server = new Server({
    name: 'healthie-api',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
    },
  });

  const healthieClient = config?.healthieClient || createHealthieClient();

  if (!healthieClient) {
    throw new Error('Healthie client not configured. Set HEALTHIE_API_KEY environment variable.');
  }

  // Tool: Get client labs
  server.setRequestHandler('tools/list', async () => ({
    tools: [
      {
        name: 'get_client_labs',
        description: 'Get lab results for a Healthie client. Returns lab results, dates, and status.',
        inputSchema: {
          type: 'object',
          properties: {
            client_id: {
              type: 'string',
              description: 'Healthie client ID',
            },
          },
          required: ['client_id'],
        },
      },
      {
        name: 'get_client_info',
        description: 'Get detailed information about a Healthie client',
        inputSchema: {
          type: 'object',
          properties: {
            client_id: {
              type: 'string',
              description: 'Healthie client ID',
            },
          },
          required: ['client_id'],
        },
      },
      {
        name: 'find_client',
        description: 'Find a Healthie client by email or phone number',
        inputSchema: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              description: 'Client email address',
            },
            phone: {
              type: 'string',
              description: 'Client phone number',
            },
          },
        },
      },
      {
        name: 'get_client_invoices',
        description: 'Get invoices for a Healthie client',
        inputSchema: {
          type: 'object',
          properties: {
            client_id: {
              type: 'string',
              description: 'Healthie client ID',
            },
          },
          required: ['client_id'],
        },
      },
      {
        name: 'get_client_subscriptions',
        description: 'Get active subscriptions for a Healthie client',
        inputSchema: {
          type: 'object',
          properties: {
            client_id: {
              type: 'string',
              description: 'Healthie client ID',
            },
          },
          required: ['client_id'],
        },
      },
    ],
  }));

  // Tool execution handler
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'get_client_labs': {
          const { client_id } = args as { client_id: string };

          // Note: This is a placeholder - you'll need to implement
          // the actual Healthie API call to get labs
          // Healthie API structure may vary
          
          const client = await healthieClient.getClient(client_id);
          
          // For now, return client info with note about labs
          // You'll need to add a getClientLabs method to HealthieClient
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  client_id,
                  client_name: `${client.first_name} ${client.last_name}`,
                  note: 'Lab results retrieval needs to be implemented based on Healthie API structure',
                  client_info: client,
                }, null, 2),
              },
            ],
          };
        }

        case 'get_client_info': {
          const { client_id } = args as { client_id: string };

          const client = await healthieClient.getClient(client_id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(client, null, 2),
              },
            ],
          };
        }

        case 'find_client': {
          const { email, phone } = args as { email?: string; phone?: string };

          let client = null;

          if (email) {
            client = await healthieClient.findClientByEmail(email);
          } else if (phone) {
            client = await healthieClient.findClientByPhone(phone);
          } else {
            throw new Error('Either email or phone must be provided');
          }

          if (!client) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Client not found in Healthie',
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(client, null, 2),
              },
            ],
          };
        }

        case 'get_client_invoices': {
          const { client_id } = args as { client_id: string };

          const invoices = await healthieClient.getClientInvoices(client_id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(invoices, null, 2),
              },
            ],
          };
        }

        case 'get_client_subscriptions': {
          const { client_id } = args as { client_id: string };

          const subscriptions = await healthieClient.getClientSubscriptions(client_id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(subscriptions, null, 2),
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


