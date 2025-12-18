// @ts-nocheck
/**
 * DEA & Transactions MCP Server
 * Exposes DEA logs and transaction data as MCP tools
 * 
 * This allows the AI agent to query DEA controlled substance logs
 * and transaction history
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { query } from '../db';

export interface DEAMCPServerConfig {
  // Add any config needed
}

export function createDEAMCPServer(config?: DEAMCPServerConfig) {
  const server = new Server({
    name: 'dea-transactions',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
    },
  });

  // Tool: Get DEA dispenses
  server.setRequestHandler('tools/list', async () => ({
    tools: [
      {
        name: 'get_dispenses',
        description: 'Get DEA controlled substance dispenses. Can filter by patient, date range, medication, or provider.',
        inputSchema: {
          type: 'object',
          properties: {
            patient_id: {
              type: 'string',
              description: 'Filter by patient ID',
            },
            patient_name: {
              type: 'string',
              description: 'Filter by patient name',
            },
            start_date: {
              type: 'string',
              description: 'Start date (YYYY-MM-DD)',
            },
            end_date: {
              type: 'string',
              description: 'End date (YYYY-MM-DD)',
            },
            medication: {
              type: 'string',
              description: 'Filter by medication name',
            },
            signed_by: {
              type: 'string',
              description: 'Filter by provider who signed',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 50)',
            },
          },
        },
      },
      {
        name: 'get_patient_dispenses',
        description: 'Get all DEA dispenses for a specific patient',
        inputSchema: {
          type: 'object',
          properties: {
            patient_id: {
              type: 'string',
              description: 'Patient ID',
            },
            patient_name: {
              type: 'string',
              description: 'Patient name (if ID not available)',
            },
          },
        },
      },
      {
        name: 'get_recent_dispenses',
        description: 'Get recent DEA dispenses (last N days)',
        inputSchema: {
          type: 'object',
          properties: {
            days: {
              type: 'number',
              description: 'Number of days to look back (default: 7)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 50)',
            },
          },
        },
      },
      {
        name: 'get_unsigned_dispenses',
        description: 'Get dispenses that need provider signature',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 50)',
            },
          },
        },
      },
      {
        name: 'get_transactions',
        description: 'Get transaction history (inventory movements, dispenses, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            patient_id: {
              type: 'string',
              description: 'Filter by patient ID',
            },
            start_date: {
              type: 'string',
              description: 'Start date (YYYY-MM-DD)',
            },
            end_date: {
              type: 'string',
              description: 'End date (YYYY-MM-DD)',
            },
            transaction_type: {
              type: 'string',
              description: 'Filter by transaction type',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 50)',
            },
          },
        },
      },
    ],
  }));

  // Tool execution handler
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'get_dispenses': {
          const {
            patient_id,
            patient_name,
            start_date,
            end_date,
            medication,
            signed_by,
            limit = 50,
          } = args as {
            patient_id?: string;
            patient_name?: string;
            start_date?: string;
            end_date?: string;
            medication?: string;
            signed_by?: string;
            limit?: number;
          };

          let sql = `
            SELECT 
              d.dispense_id,
              d.patient_id,
              p.full_name AS patient_name,
              d.medication,
              d.quantity,
              d.dispensed_at,
              d.entered_by,
              d.signed_by,
              d.signed_at,
              d.signature_status,
              d.notes
            FROM dispenses d
            LEFT JOIN patients p ON d.patient_id = p.patient_id
            WHERE 1=1
          `;
          const params: any[] = [];

          if (patient_id) {
            sql += ` AND d.patient_id = $${params.length + 1}`;
            params.push(patient_id);
          }
          if (patient_name) {
            sql += ` AND p.full_name ILIKE $${params.length + 1}`;
            params.push(`%${patient_name}%`);
          }
          if (start_date) {
            sql += ` AND d.dispensed_at >= $${params.length + 1}`;
            params.push(start_date);
          }
          if (end_date) {
            sql += ` AND d.dispensed_at <= $${params.length + 1}`;
            params.push(end_date);
          }
          if (medication) {
            sql += ` AND d.medication ILIKE $${params.length + 1}`;
            params.push(`%${medication}%`);
          }
          if (signed_by) {
            sql += ` AND d.signed_by = $${params.length + 1}`;
            params.push(signed_by);
          }

          sql += ` ORDER BY d.dispensed_at DESC LIMIT $${params.length + 1}`;
          params.push(limit);

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

        case 'get_patient_dispenses': {
          const { patient_id, patient_name } = args as {
            patient_id?: string;
            patient_name?: string;
          };

          let sql = `
            SELECT 
              d.dispense_id,
              d.medication,
              d.quantity,
              d.dispensed_at,
              d.signed_by,
              d.signature_status,
              d.notes
            FROM dispenses d
            LEFT JOIN patients p ON d.patient_id = p.patient_id
            WHERE 1=1
          `;
          const params: any[] = [];

          if (patient_id) {
            sql += ` AND d.patient_id = $${params.length + 1}`;
            params.push(patient_id);
          } else if (patient_name) {
            sql += ` AND p.full_name ILIKE $${params.length + 1}`;
            params.push(`%${patient_name}%`);
          } else {
            throw new Error('Either patient_id or patient_name must be provided');
          }

          sql += ` ORDER BY d.dispensed_at DESC`;

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

        case 'get_recent_dispenses': {
          const { days = 7, limit = 50 } = args as {
            days?: number;
            limit?: number;
          };

          const results = await query(
            `
              SELECT 
                d.dispense_id,
                d.patient_id,
                p.full_name AS patient_name,
                d.medication,
                d.quantity,
                d.dispensed_at,
                d.signed_by,
                d.signature_status
              FROM dispenses d
              LEFT JOIN patients p ON d.patient_id = p.patient_id
              WHERE d.dispensed_at >= NOW() - INTERVAL '${days} days'
              ORDER BY d.dispensed_at DESC
              LIMIT $1
            `,
            [limit]
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

        case 'get_unsigned_dispenses': {
          const { limit = 50 } = args as { limit?: number };

          const results = await query(
            `
              SELECT 
                d.dispense_id,
                d.patient_id,
                p.full_name AS patient_name,
                d.medication,
                d.quantity,
                d.dispensed_at,
                d.entered_by
              FROM dispenses d
              LEFT JOIN patients p ON d.patient_id = p.patient_id
              WHERE d.signed_by IS NULL OR d.signature_status IS NULL
              ORDER BY d.dispensed_at DESC
              LIMIT $1
            `,
            [limit]
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

        case 'get_transactions': {
          const {
            patient_id,
            start_date,
            end_date,
            transaction_type,
            limit = 50,
          } = args as {
            patient_id?: string;
            start_date?: string;
            end_date?: string;
            transaction_type?: string;
            limit?: number;
          };

          // This is a template - adjust based on your actual transactions table structure
          let sql = `
            SELECT 
              transaction_id,
              patient_id,
              transaction_type,
              transaction_date,
              amount,
              notes
            FROM transactions
            WHERE 1=1
          `;
          const params: any[] = [];

          if (patient_id) {
            sql += ` AND patient_id = $${params.length + 1}`;
            params.push(patient_id);
          }
          if (start_date) {
            sql += ` AND transaction_date >= $${params.length + 1}`;
            params.push(start_date);
          }
          if (end_date) {
            sql += ` AND transaction_date <= $${params.length + 1}`;
            params.push(end_date);
          }
          if (transaction_type) {
            sql += ` AND transaction_type = $${params.length + 1}`;
            params.push(transaction_type);
          }

          sql += ` ORDER BY transaction_date DESC LIMIT $${params.length + 1}`;
          params.push(limit);

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


