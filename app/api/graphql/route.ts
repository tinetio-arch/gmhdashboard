/**
 * GraphQL API Route
 * This is your GraphQL endpoint - works just like your REST API routes!
 * No separate server needed - it's part of your Next.js app
 */

import { NextRequest, NextResponse } from 'next/server';
import { graphql } from 'graphql';
import { schema } from '@/lib/graphql/schema';
import { requireApiUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // Authenticate user (same as your REST endpoints)
    const user = await requireApiUser(request, 'read');
    
    // Get the GraphQL query from request body
    const body = await request.json();
    const { query, variables } = body;

    if (!query) {
      return NextResponse.json(
        { errors: [{ message: 'GraphQL query is required' }] },
        { status: 400 }
      );
    }

    // Execute the GraphQL query
    const result = await graphql({
      schema,
      source: query,
      variableValues: variables,
      contextValue: {
        user, // Pass user to resolvers
        // Add database connection, Healthie client, Stripe client, etc.
      },
    });

    // Return the result
    return NextResponse.json(result);
  } catch (error) {
    console.error('GraphQL error:', error);
    return NextResponse.json(
      { 
        errors: [{ 
          message: error instanceof Error ? error.message : 'GraphQL execution failed' 
        }] 
      },
      { status: 500 }
    );
  }
}

// Optional: Also support GET for GraphQL Playground
export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'GraphQL endpoint. Use POST to send queries.',
    graphql: true,
  });
}

