/**
 * UTC-Safe Date Formatting Utilities
 * 
 * These functions prevent React hydration errors by ensuring dates are formatted
 * consistently between server and client, regardless of timezone.
 * 
 * ALWAYS use these instead of:
 * - date.toLocaleDateString() ❌
 * - date.toLocaleString() ❌
 * - new Date().toLocaleDateString() ❌
 */

/**
 * Format date as MM-DD-YYYY using UTC timezone
 * Prevents hydration errors from timezone differences
 */
export function formatDateUTC(date: Date | string | null | undefined): string {
    if (!date) return '—';

    try {
        const d = typeof date === 'string' ? new Date(date) : date;
        if (isNaN(d.getTime())) return '—';

        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        const year = d.getUTCFullYear();

        return `${month}-${day}-${year}`;
    } catch {
        return '—';
    }
}

/**
 * Format datetime as MM-DD-YYYY HH:MM AM/PM using UTC timezone
 * Prevents hydration errors from timezone differences
 */
export function formatDateTimeUTC(date: Date | string | null | undefined): string {
    if (!date) return '—';

    try {
        const d = typeof date === 'string' ? new Date(date) : date;
        if (isNaN(d.getTime())) return '—';

        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        const year = d.getUTCFullYear();

        let hours = d.getUTCHours();
        const minutes = String(d.getUTCMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;

        return `${month}-${day}-${year} ${hours}:${minutes} ${ampm}`;
    } catch {
        return '—';
    }
}

/**
 * Format relative time (e.g., "2 hours ago", "3 days ago")
 * Safe for both server and client rendering
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
    if (!date) return '—';

    try {
        const d = typeof date === 'string' ? new Date(date) : date;
        if (isNaN(d.getTime())) return '—';

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
    } catch {
        return '—';
    }
}

/**
 * Format date as "Jan 15, 2025" using UTC
 */
export function formatDateLong(date: Date | string | null | undefined): string {
    if (!date) return '—';

    try {
        const d = typeof date === 'string' ? new Date(date) : date;
        if (isNaN(d.getTime())) return '—';

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[d.getUTCMonth()];
        const day = d.getUTCDate();
        const year = d.getUTCFullYear();

        return `${month} ${day}, ${year}`;
    } catch {
        return '—';
    }
}
