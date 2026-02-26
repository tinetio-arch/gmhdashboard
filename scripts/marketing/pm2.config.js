module.exports = {
    apps: [
        {
            name: 'marketing-orchestrator',
            script: 'python3',
            args: 'marketing_orchestrator.py daily',
            cwd: '/home/ec2-user/gmhdashboard/scripts/marketing',
            cron_restart: '0 8 * * *',  // Run daily at 8 AM
            autorestart: false,  // Don't auto-restart (cron handles scheduling)
            watch: false,
            env: {
                NODE_ENV: 'production'
            }
        },
        {
            name: 'marketing-approver',
            script: 'python3',
            args: 'marketing_approver.py',
            cwd: '/home/ec2-user/gmhdashboard/scripts/marketing',
            autorestart: true,
            watch: false,
            max_restarts: 10,
            restart_delay: 5000,
            env: {
                NODE_ENV: 'production'
            }
        }
    ]
};
