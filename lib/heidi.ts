/**
 * Heidi API Client
 * ----------------
 * Minimal wrapper around Heidi's Open API for transcription + consult notes.
 * Docs: https://www.heidihealth.com/developers/heidi-api/overview
 */

const DEFAULT_BASE_URL = 'https://registrar.api.heidihealth.com/api/v2/ml-scribe/open-api/';

export type HeidiConfig = {
  apiKey: string;
  baseUrl?: string;
};

export type HeidiSession = {
  sessionId: string;
  status: string;
};

export type HeidiNote = {
  id: string;
  content: string;
  format: 'markdown' | 'text' | string;
};

export class HeidiClient {
  private readonly baseUrl: string;

  constructor(private readonly config: HeidiConfig) {
    if (!config.apiKey) {
      throw new Error('Heidi API key is required');
    }
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const response = await fetch(url.toString(), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Heidi API error: ${response.status} ${response.statusText} - ${body}`);
    }

    return (await response.json()) as T;
  }

  async createSession(payload: {
    patientId: string;
    providerId: string;
    templateId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<HeidiSession> {
    const result = await this.request<{ sessionId: string; status: string }>('sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return result;
  }

  async appendContext(sessionId: string, context: Record<string, unknown>): Promise<void> {
    await this.request(`sessions/${sessionId}/context`, {
      method: 'POST',
      body: JSON.stringify(context),
    });
  }

  async publishTranscription(sessionId: string, payload: { text: string }): Promise<void> {
    await this.request(`sessions/${sessionId}/transcription`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async fetchConsultNote(sessionId: string): Promise<HeidiNote> {
    return this.request<HeidiNote>(`sessions/${sessionId}/consult-note`, {
      method: 'GET',
    });
  }
}

export function createHeidiClient(): HeidiClient | null {
  const apiKey = process.env.HEIDI_API_KEY;
  if (!apiKey) {
    console.warn('[Heidi] API key not configured.');
    return null;
  }

  return new HeidiClient({
    apiKey,
    baseUrl: process.env.HEIDI_API_BASE_URL || DEFAULT_BASE_URL,
  });
}


