// Load dotenv first
require('dotenv').config({ path: '/home/ec2-user/.env' });

module.exports = {
  apps: [
    {
      name: 'telegram-ai-bot-v2',
      cwd: '/home/ec2-user/gmhdashboard',
      script: 'scripts/telegram-ai-bot-v2.ts',
      interpreter: 'npx',
      interpreter_args: 'tsx',
      // Pass all current env vars including those loaded from .env
      env: process.env,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
