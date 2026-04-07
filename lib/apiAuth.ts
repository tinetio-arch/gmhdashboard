import { NextRequest } from 'next/server';

export async function requireApiKey(request: NextRequest) {
    const apiKey = request.headers.get('x-api-key');

    // Check if API key is provided
    if (!apiKey) {
        return { authenticated: false, error: 'API key required' };
    }

    // Basic validation - you can enhance this with actual API key verification
    const validApiKey = process.env.API_KEY || 'your-secret-api-key';
    if (apiKey !== validApiKey) {
        return { authenticated: false, error: 'Invalid API key' };
    }

    return { authenticated: true };
}