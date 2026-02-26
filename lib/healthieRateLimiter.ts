/**
 * Healthie API Rate Limiter
 * 
 * Token-bucket rate limiter that prevents Healthie API rate limit lockouts.
 * Healthie limits: 250 req/s general, but 39+ rapid requests trigger 30-60 min lockouts.
 * This limiter defaults to 5 req/s (safe margin) with automatic 429 backoff.
 * 
 * USAGE:
 *   import { healthieRateLimiter, healthieRateLimitedFetch } from '@/lib/healthieRateLimiter';
 * 
 *   // Option 1: Rate-limited fetch (drop-in replacement)
 *   const response = await healthieRateLimitedFetch(url, options);
 * 
 *   // Option 2: Manual acquire (for custom logic)
 *   await healthieRateLimiter.acquire();
 *   const response = await fetch(url, options);
 * 
 * SINGLETON: One limiter per process — all callers share the same queue.
 */

class HealthieRateLimiter {
    private tokens: number;
    private maxTokens: number;
    private refillRateMs: number; // ms between token refills
    private lastRefillTime: number;
    private queue: Array<{ resolve: () => void }> = [];
    private draining = false;
    private backoffUntil = 0; // timestamp when backoff expires

    /**
     * @param requestsPerSecond - Max requests per second (default: 5, well under Healthie's 250/s)
     */
    constructor(requestsPerSecond = 5) {
        this.maxTokens = requestsPerSecond;
        this.tokens = requestsPerSecond;
        this.refillRateMs = Math.ceil(1000 / requestsPerSecond); // e.g., 200ms for 5 req/s
        this.lastRefillTime = Date.now();
    }

    /**
     * Refill tokens based on elapsed time
     */
    private refill(): void {
        const now = Date.now();
        const elapsed = now - this.lastRefillTime;
        const tokensToAdd = Math.floor(elapsed / this.refillRateMs);
        if (tokensToAdd > 0) {
            this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
            this.lastRefillTime = now;
        }
    }

    /**
     * Wait for a rate limit token. Resolves when it's safe to make a request.
     */
    async acquire(): Promise<void> {
        // If in backoff mode, wait until backoff expires
        const now = Date.now();
        if (this.backoffUntil > now) {
            const waitMs = this.backoffUntil - now;
            console.warn(`[HealthieRateLimiter] In backoff mode, waiting ${Math.ceil(waitMs / 1000)}s...`);
            await this.sleep(waitMs);
        }

        return new Promise<void>((resolve) => {
            this.queue.push({ resolve });
            this.drain();
        });
    }

    /**
     * Process queued requests, granting tokens as they become available
     */
    private async drain(): Promise<void> {
        if (this.draining) return;
        this.draining = true;

        while (this.queue.length > 0) {
            this.refill();

            if (this.tokens > 0) {
                this.tokens--;
                const next = this.queue.shift();
                if (next) next.resolve();
            } else {
                // Wait for next token refill
                await this.sleep(this.refillRateMs);
            }
        }

        this.draining = false;
    }

    /**
     * Trigger backoff after a 429 response. All requests will wait.
     * @param durationMs - How long to back off (default: 60 seconds)
     */
    backoff(durationMs = 60_000): void {
        this.backoffUntil = Date.now() + durationMs;
        this.tokens = 0; // drain all tokens
        console.error(
            `[HealthieRateLimiter] 🚨 429 received! Backing off for ${durationMs / 1000}s. ` +
            `No Healthie requests until ${new Date(this.backoffUntil).toISOString()}`
        );
    }

    /**
     * Check if currently in backoff mode
     */
    isBackingOff(): boolean {
        return Date.now() < this.backoffUntil;
    }

    /**
     * Get current queue depth (for monitoring)
     */
    get queueDepth(): number {
        return this.queue.length;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

// Singleton instance — shared across the entire process
export const healthieRateLimiter = new HealthieRateLimiter(5);

/**
 * Rate-limited fetch for Healthie API.
 * Drop-in replacement for `fetch()` that waits for a rate limit token first.
 * Automatically triggers backoff on HTTP 429.
 * 
 * @param url - The URL to fetch
 * @param options - Standard fetch options
 * @param retryOn429 - Whether to retry once after 429 backoff (default: true)
 * @returns The fetch Response
 */
export async function healthieRateLimitedFetch(
    url: string,
    options?: RequestInit,
    retryOn429 = true
): Promise<Response> {
    await healthieRateLimiter.acquire();

    const response = await fetch(url, options);

    if (response.status === 429) {
        // Extract retry-after header if present, else default to 60s
        const retryAfter = response.headers.get('retry-after');
        const backoffMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
        healthieRateLimiter.backoff(backoffMs);

        if (retryOn429) {
            // Wait for backoff to expire, then retry once
            await healthieRateLimiter.acquire();
            return fetch(url, options);
        }
    }

    return response;
}
