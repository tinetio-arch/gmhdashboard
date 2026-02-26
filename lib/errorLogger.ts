/**
 * Centralized Error Logging Utility
 * 
 * Provides consistent error logging across all subsystems.
 * Prevents silent failures by standardizing error handling.
 * 
 * Usage:
 *   import { logError, logWarn } from '@/lib/errorLogger';
 *   
 *   try { ... } catch (err) {
 *     logError('Labs', 'Failed to process lab order', err, { orderId });
 *   }
 */

type Severity = 'error' | 'warn' | 'info';

interface LogContext {
    [key: string]: unknown;
}

function formatMessage(subsystem: string, message: string, error?: unknown, context?: LogContext): string {
    const parts = [`[${subsystem}] ${message}`];

    if (error instanceof Error) {
        parts.push(`| ${error.message}`);
    } else if (error) {
        parts.push(`| ${String(error)}`);
    }

    if (context && Object.keys(context).length > 0) {
        parts.push(`| ctx: ${JSON.stringify(context)}`);
    }

    return parts.join(' ');
}

/**
 * Log an error with subsystem prefix and optional context.
 * Use this instead of bare `catch {}` or `console.error` to ensure
 * consistent, searchable error logs.
 */
export function logError(subsystem: string, message: string, error?: unknown, context?: LogContext): void {
    console.error(formatMessage(subsystem, message, error, context));
}

/**
 * Log a warning with subsystem prefix.
 */
export function logWarn(subsystem: string, message: string, context?: LogContext): void {
    console.warn(formatMessage(subsystem, message, undefined, context));
}

/**
 * Log an info message with subsystem prefix.
 */
export function logInfo(subsystem: string, message: string, context?: LogContext): void {
    console.log(formatMessage(subsystem, message, undefined, context));
}
