/**
 * PM2 Ecosystem Configuration
 * 
 * CRITICAL: All services MUST use these restart limits to prevent CPU meltdown.
 * 
 * Standard Settings:
 *   max_restarts: 10       - Stop after 10 consecutive failures
 *   restart_delay: 5000    - Wait 5 seconds between restarts
 *   exp_backoff: 1000     - Exponential backoff starting at 1s
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 start ecosystem.config.js --only upload-receiver
 */

module.exports = {
    apps: [
        // ============================================
        // AI SCRIBE - Audio Upload Receiver
        // ============================================
        {
            name: 'upload-receiver',
            script: 'upload_receiver.js',
            cwd: '/home/ec2-user/scripts/scribe',
            max_restarts: 10,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            max_memory_restart: '500M'
        },

        // ============================================
        // TELEGRAM BOT - AI Query Bot
        // ============================================
        {
            name: 'telegram-ai-bot-v2',
            script: 'scripts/telegram-ai-bot-v2.ts',
            cwd: '/home/ec2-user/gmhdashboard',
            interpreter: 'npx',
            interpreter_args: 'tsx --no-cache',
            max_restarts: 10,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            max_memory_restart: '500M'
        },

        // ============================================
        // DASHBOARD - Next.js Admin Panel
        // Runs startup-payment-sync before starting server
        // ============================================
        {
            name: 'gmh-dashboard',
            script: '/home/ec2-user/gmhdashboard/scripts/start-dashboard.sh',
            cwd: '/home/ec2-user/gmhdashboard',
            interpreter: '/bin/bash',
            max_restarts: 10,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'production',
                PORT: 3011
            }
        },

        // ============================================
        // EMAIL TRIAGE - Email Processing
        // ============================================
        {
            name: 'email-triage',
            script: 'email-monitor.py',
            cwd: '/home/ec2-user/gmhdashboard/scripts/email-triage',
            interpreter: 'python3',
            max_restarts: 10,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            max_memory_restart: '500M'
        },

        // ============================================
        // FAX PROCESSOR - Incoming Fax S3 Monitor
        // Monitors gmh-incoming-faxes-east1 bucket for SES-delivered faxes
        // ============================================
        {
            name: 'fax-processor',
            script: 'fax_s3_processor.py',
            cwd: '/home/ec2-user/gmhdashboard/scripts/email-triage',
            interpreter: 'python3',
            max_restarts: 10,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            max_memory_restart: '500M'
        },

        // ============================================
        // GHL WEBHOOKS - GoHighLevel Integration
        // ============================================
        {
            name: 'ghl-webhooks',
            script: 'webhook-server.js',
            cwd: '/home/ec2-user/gmhdashboard/scripts/ghl-integration',
            max_restarts: 10,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            max_memory_restart: '500M'
        },

        // ============================================
        // NOWPRIMARY WEBSITE - Primary Care Website
        // ============================================
        {
            name: 'nowprimary-website',
            script: 'npm',
            args: 'start',
            cwd: '/home/ec2-user/nowprimarycare-website',
            max_restarts: 10,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            max_memory_restart: '500M',
            env: {
                NODE_ENV: 'production',
                PORT: 3004
            }
        },

        // ============================================
        // NOWMENSHEALTH WEBSITE - Men's Health Website
        // ============================================
        {
            name: 'nowmenshealth-website',
            script: 'npm',
            args: 'start',
            cwd: '/home/ec2-user/nowmenshealth-website',
            max_restarts: 10,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            max_memory_restart: '500M',
            env: {
                NODE_ENV: 'production',
                PORT: 3005
            }
        },

        // ============================================
        // NOWOPTIMAL WEBSITE - Parent/Landing Site
        // ============================================
        {
            name: 'nowoptimal-website',
            script: 'npm',
            args: 'start',
            cwd: '/home/ec2-user/nowoptimal-website',
            max_restarts: 10,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            max_memory_restart: '500M',
            env: {
                NODE_ENV: 'production',
                PORT: 3008
            }
        },

        // ============================================
        // JESSICA MCP - AI Model Context Protocol Server
        // Requires Python 3.11+ for MCP package
        // ============================================
        {
            name: 'jessica-mcp',
            script: 'server.py',
            cwd: '/home/ec2-user/mcp-server',
            interpreter: 'python3.11',
            max_restarts: 10,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            max_memory_restart: '500M'
        },

        // ============================================
        // UPTIME MONITOR - Real-time HTTP & PM2 Monitoring
        // ============================================
        {
            name: 'uptime-monitor',
            script: 'uptime_monitor.py',
            args: '--daemon',
            cwd: '/home/ec2-user/scripts',
            interpreter: 'python3',
            max_restarts: 10,
            restart_delay: 5000,
            exp_backoff_restart_delay: 1000,
            max_memory_restart: '200M'
        }
    ]
};
