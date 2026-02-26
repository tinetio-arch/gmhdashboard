/**
 * Shared Healthie GraphQL helper — rate-limited, authenticated, error-handled.
 * 
 * USE THIS instead of raw `fetch('https://api.gethealthie.com/graphql', ...)` 
 * in API routes and scripts that don't use HealthieClient.
 * 
 * USAGE:
 *   import { healthieGraphQL } from '@/lib/healthieApi';
 * 
 *   // Simple query
 *   const data = await healthieGraphQL<{ users: User[] }>(`
 *     query { users(offset: 0, limit: 10) { id first_name } }
 *   `);
 * 
 *   // With variables
 *   const data = await healthieGraphQL<{ user: User }>(`
 *     query GetUser($id: ID!) { user(id: $id) { id first_name } }
 *   `, { id: '12345' });
 * 
 *   // With custom API key (overrides env var)
 *   const data = await healthieGraphQL(query, vars, { apiKey: 'gh_live_...' });
 * 
 * RATE LIMITED: Uses the same shared healthieRateLimiter singleton as HealthieClient.
 */

import { healthieRateLimiter } from './healthieRateLimiter';

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

interface HealthieGraphQLOptions {
    /** Override the default API key from env */
    apiKey?: string;
    /** Override the default API URL */
    apiUrl?: string;
}

/**
 * Execute a rate-limited Healthie GraphQL query/mutation.
 * 
 * Handles: auth headers, rate limiting, 429 backoff + retry, error extraction.
 * 
 * @throws Error if API returns non-200 or GraphQL errors
 */
export async function healthieGraphQL<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    options?: HealthieGraphQLOptions
): Promise<T> {
    const apiKey = options?.apiKey || HEALTHIE_API_KEY;
    const apiUrl = options?.apiUrl || HEALTHIE_API_URL;

    if (!apiKey) {
        throw new Error('Healthie API key is required — set HEALTHIE_API_KEY in .env.local');
    }

    const headers = {
        'Authorization': `Basic ${apiKey}`,
        'AuthorizationSource': 'API',
        'Content-Type': 'application/json',
    };
    const body = JSON.stringify({ query, variables });

    // Rate limit: wait for a token before making the request
    await healthieRateLimiter.acquire();

    let response = await fetch(apiUrl, { method: 'POST', headers, body });

    // Handle 429 rate limit: backoff and retry once
    if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const backoffMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
        healthieRateLimiter.backoff(backoffMs);
        await healthieRateLimiter.acquire();
        response = await fetch(apiUrl, { method: 'POST', headers, body });
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Healthie API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();

    if (result.errors) {
        const errorMessages = result.errors.map((e: { message: string }) => e.message).join(', ');
        throw new Error(`Healthie GraphQL error: ${errorMessages}`);
    }

    return result.data as T;
}

/**
 * Execute a raw rate-limited fetch to Healthie (for non-GraphQL endpoints).
 * Adds auth headers and rate limiting automatically.
 */
export async function healthieFetch(
    url: string,
    options?: RequestInit & { apiKey?: string }
): Promise<Response> {
    const apiKey = options?.apiKey || HEALTHIE_API_KEY;

    await healthieRateLimiter.acquire();

    const headers = {
        'Authorization': `Basic ${apiKey}`,
        'AuthorizationSource': 'API',
        'Content-Type': 'application/json',
        ...options?.headers,
    };

    let response = await fetch(url, { ...options, headers });

    if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const backoffMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
        healthieRateLimiter.backoff(backoffMs);
        await healthieRateLimiter.acquire();
        response = await fetch(url, { ...options, headers });
    }

    return response;
}
