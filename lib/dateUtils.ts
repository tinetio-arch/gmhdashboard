/**
 * Arizona (America/Phoenix) Date Formatting Utilities
 * 
 * Arizona does NOT observe DST — always UTC-7 (MST).
 * All dates are formatted in Arizona time to match the clinic's physical location.
 * 
 * These functions also prevent React hydration errors by using deterministic
 * timezone formatting via Intl.DateTimeFormat instead of locale-dependent methods.
 * 
 * ALWAYS use these instead of:
 * - date.toLocaleDateString() ❌
 * - date.toLocaleString() ❌
 * - date.getUTCMonth() / getUTCDate() ❌
 */

const AZ_TZ = 'America/Phoenix';

/** Parse a date value safely, handling date-only strings without UTC shift */
function parseDate(date: Date | string): Date | null {
    try {
        if (date instanceof Date) return isNaN(date.getTime()) ? null : date;
        const s = String(date).trim();
        if (!s) return null;
        // Date-only strings (YYYY-MM-DD): parse as noon UTC to avoid any day-boundary shift
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            const d = new Date(`${s}T12:00:00Z`);
            return isNaN(d.getTime()) ? null : d;
        }
        // Add timezone if missing to avoid browser-local interpretation
        const candidate = s.replace(' ', 'T');
        const iso = candidate.includes('Z') || candidate.includes('+') || candidate.includes('-', 10)
            ? candidate
            : `${candidate}Z`;
        const d = new Date(iso);
        return isNaN(d.getTime()) ? null : d;
    } catch {
        return null;
    }
}

/** Get date parts in Arizona timezone */
function azParts(d: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: AZ_TZ, ...options }).formatToParts(d);
    const result: Record<string, string> = {};
    for (const p of parts) result[p.type] = p.value;
    return result;
}

/**
 * Format date as MM/DD/YYYY in Arizona timezone
 */
export function formatDateUTC(date: Date | string | null | undefined): string {
    if (!date) return '—';
    const d = parseDate(date);
    if (!d) return '—';

    const p = azParts(d, { month: '2-digit', day: '2-digit', year: 'numeric' });
    return `${p.month}/${p.day}/${p.year}`;
}

/**
 * Format datetime as MM/DD/YYYY h:MM AM/PM in Arizona timezone
 */
export function formatDateTimeUTC(date: Date | string | null | undefined): string {
    if (!date) return '—';
    const d = parseDate(date);
    if (!d) return '—';

    const p = azParts(d, {
        month: '2-digit', day: '2-digit', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
    });
    return `${p.month}/${p.day}/${p.year} ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/**
 * Format relative time (e.g., "2 hours ago", "3 days ago")
 * This is timezone-independent (relative to now)
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
    if (!date) return '—';
    const d = parseDate(date);
    if (!d) return '—';

    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'just now';
}

/**
 * Format date as "Jan 15, 2025" in Arizona timezone
 */
export function formatDateLong(date: Date | string | null | undefined): string {
    if (!date) return '—';
    const d = parseDate(date);
    if (!d) return '—';

    const p = azParts(d, { month: 'short', day: 'numeric', year: 'numeric' });
    return `${p.month} ${p.day}, ${p.year}`;
}
