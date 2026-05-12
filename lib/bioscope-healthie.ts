import { HealthieClient } from './healthie';

let bioscopeHealthieInstance: HealthieClient | null = null;

export function getBioscopeHealthieClient(): HealthieClient {
  if (!bioscopeHealthieInstance) {
    const apiKey = process.env.BIOSCOPE_HEALTHIE_API_KEY;
    if (!apiKey) {
      throw new Error('BIOSCOPE_HEALTHIE_API_KEY environment variable is not configured');
    }
    bioscopeHealthieInstance = new HealthieClient({
      apiKey,
      apiUrl: process.env.HEALTHIE_API_URL,
    });
  }
  return bioscopeHealthieInstance;
}
