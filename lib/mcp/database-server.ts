// @ts-nocheck
/**
 * Database MCP Server
 * Exposes PostgreSQL database as MCP tools for agentic AI
 * 
 * This allows the AI agent to query your database using natural language
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { query } from '../db';

export interface DatabaseMCPServerConfig {
  // Add any config needed
}

export function createDatabaseMCPServer(config?: DatabaseMCPServerConfig) {
  const server = new Server({
    name: 'gmh-database',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
    },
  });

  // Tool: Query patients by name, email, or phone
  server.setRequestHandler('tools/list', async () => ({
    tools: [
      {
        name: 'query_patients',
        description: 'Search for patients by name, email, or phone number. Returns patient information including ID, name, email, phone, and status.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Patient name (full or partial)',
            },
            email: {
              type: 'string',
              description: 'Patient email address',
            },
            phone: {
              type: 'string',
              description: 'Patient phone number',
            },
          },
        },
      },
      {
        name: 'get_patient_info',
        description: 'Get detailed information about a specific patient by ID',
        inputSchema: {
          type: 'object',
          properties: {
            patient_id: {
              type: 'string',
              description: 'Patient ID (UUID)',
            },
          },
          required: ['patient_id'],
        },
      },
      {
        name: 'get_patient_labs',
        description: 'Get lab results for a patient. Returns last lab date, next lab date, and lab status.',
        inputSchema: {
          type: 'object',
          properties: {
            patient_id: {
              type: 'string',
              description: 'Patient ID (UUID)',
            },
          },
          required: ['patient_id'],
        },
      },
      {
        name: 'search_patients',
        description: 'Search patients with flexible query. Can search by any field.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (searches name, email, phone)',
            },
          },
          required: ['query'],
        },
      },
    ],
  }));

  // Tool execution handler
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'query_patients': {
          const { name: patientName, email, phone } = args as {
            name?: string;
            email?: string;
            phone?: string;
          };

          let sql = `
            SELECT 
              patient_id,
              full_name AS name,
              email,
              phone_primary AS phone,
              alert_status AS status,
              last_lab,
              next_lab,
              method_of_payment
            FROM patients
            WHERE 1=1
          `;
          const params: string[] = [];

          if (patientName) {
            sql += ` AND full_name ILIKE $${params.length + 1}`;
            params.push(`%${patientName}%`);
          }
          if (email) {
            sql += ` AND email ILIKE $${params.length + 1}`;
            params.push(`%${email}%`);
          }
          if (phone) {
            // Normalize phone (remove non-digits)
            const normalizedPhone = phone.replace(/\D/g, '');
            sql += ` AND REPLACE(REPLACE(REPLACE(REPLACE(phone_primary, ' ', ''), '-', ''), '(', ''), ')', '') LIKE $${params.length + 1}`;
            params.push(`%${normalizedPhone}%`);
          }

          sql += ` ORDER BY full_name LIMIT 20`;

          const results = await query(sql, params);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        }

        case 'get_patient_info': {
          const { patient_id } = args as { patient_id: string };

          const results = await query(
            `
              SELECT 
                patient_id,
                full_name AS name,
                email,
                phone_primary AS phone,
                date_of_birth AS dob,
                address_line1 AS address,
                city,
                state,
                postal_code AS zip,
                alert_status AS status,
                method_of_payment,
                type_of_client,
                service_start_date,
                contract_end,
                patient_notes
              FROM patients
              WHERE patient_id = $1
            `,
            [patient_id]
          );

          if (results.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Patient not found with ID: ${patient_id}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(results[0], null, 2),
              },
            ],
          };
        }

        case 'get_patient_labs': {
          const { patient_id } = args as { patient_id: string };

          const results = await query(
            `
              SELECT 
                patient_id,
                full_name AS name,
                last_lab,
                next_lab,
                lab_status,
                lab_notes
              FROM patients
              WHERE patient_id = $1
            `,
            [patient_id]
          );

          if (results.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Patient not found with ID: ${patient_id}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(results[0], null, 2),
              },
            ],
          };
        }

        case 'search_patients': {
          const { query: searchQuery } = args as { query: string };

          const results = await query(
            `
              SELECT 
                patient_id,
                full_name AS name,
                email,
                phone_primary AS phone,
                alert_status AS status
              FROM patients
              WHERE 
                full_name ILIKE $1
                OR email ILIKE $1
                OR phone_primary ILIKE $1
              ORDER BY full_name
              LIMIT 20
            `,
            [`%${searchQuery}%`]
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(results, null, 2),
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


