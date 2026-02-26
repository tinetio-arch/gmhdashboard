/**
 * Gemini AI Client Module
 */

// Load env
require('dotenv').config({ path: '/home/ec2-user/.env' });

import { GeminiToolResponse, AGENTIC_TOOLS } from './types';

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;

/**
 * Call Gemini for text generation
 */
export async function callGemini(
    prompt: string,
    maxTokens: number = 1000,
    temperature: number = 0
): Promise<string> {
    if (!GOOGLE_AI_API_KEY) {
        throw new Error('GOOGLE_AI_API_KEY not configured');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
        throw new Error('Invalid Gemini response format');
    }

    return data.candidates[0].content.parts[0].text.trim();
}

/**
 * Call Gemini with function calling (agentic mode)
 */
export async function callGeminiWithTools(
    prompt: string,
    systemPrompt?: string
): Promise<GeminiToolResponse> {
    if (!GOOGLE_AI_API_KEY) {
        throw new Error('GOOGLE_AI_API_KEY not configured');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`;

    const contents: any[] = [];

    // Add system instruction if provided
    if (systemPrompt) {
        contents.push({ role: "user", parts: [{ text: systemPrompt }] });
        contents.push({ role: "model", parts: [{ text: "I understand. I will help with clinic operations using the available tools." }] });
    }

    contents.push({ role: "user", parts: [{ text: prompt }] });

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents,
            tools: [AGENTIC_TOOLS],
            generationConfig: {
                temperature: 0,
                maxOutputTokens: 1000
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0]?.content?.parts?.[0];

    if (!candidate) {
        throw new Error('Invalid Gemini response format');
    }

    // Check if Gemini wants to call a function
    if (candidate.functionCall) {
        return {
            functionCall: {
                name: candidate.functionCall.name,
                args: candidate.functionCall.args || {}
            }
        };
    }

    // Otherwise return text response
    return { text: candidate.text?.trim() };
}
