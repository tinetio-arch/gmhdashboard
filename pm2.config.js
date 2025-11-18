module.exports = {
  apps: [
    {
      name: 'gmh-dashboard',
      cwd: '/home/ec2-user/apps/gmh-dashboard',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3400',
      interpreter: 'node',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DATABASE_HOST: 'clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com',
        DATABASE_PORT: '5432',
        DATABASE_NAME: 'postgres',
        DATABASE_USER: 'clinicadmin',
        DATABASE_PASSWORD: 'or0p5g!JL65cY3Y-l6+V%&RC',
        DATABASE_SSLMODE: 'require',
        PGSSLMODE: 'require',
        NEXT_TELEMETRY_DISABLED: '1',
        SESSION_SECRET: 'change-me-session-secret',
        NEXT_PUBLIC_BASE_PATH: '/ops',
        QUICKBOOKS_CLIENT_ID: 'AB9kAOBoZoKKCk60j8pu9dniJQPfVe5hc7lAar62NurYBhs1ZM',
        QUICKBOOKS_CLIENT_SECRET: 'oX4NIOJ8VpGUJGWVlVVNzL2jyGuUal1ij90U6fUK',
        QUICKBOOKS_REDIRECT_URI: 'https://nowoptimal.com/ops/api/auth/quickbooks/callback',
        QUICKBOOKS_ENVIRONMENT: 'production'
      },
      env_production: {
        NODE_ENV: 'production',
        DATABASE_HOST: 'clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com',
        DATABASE_PORT: '5432',
        DATABASE_NAME: 'postgres',
        DATABASE_USER: 'clinicadmin',
        DATABASE_PASSWORD: 'or0p5g!JL65cY3Y-l6+V%&RC',
        DATABASE_SSLMODE: 'require',
        PGSSLMODE: 'require',
        NEXT_TELEMETRY_DISABLED: '1',
        SESSION_SECRET: 'change-me-session-secret',
        NEXT_PUBLIC_BASE_PATH: '/ops',
        QUICKBOOKS_CLIENT_ID: 'AB9kAOBoZoKKCk60j8pu9dniJQPfVe5hc7lAar62NurYBhs1ZM',
        QUICKBOOKS_CLIENT_SECRET: 'oX4NIOJ8VpGUJGWVlVVNzL2jyGuUal1ij90U6fUK',
        QUICKBOOKS_REDIRECT_URI: 'https://nowoptimal.com/ops/api/auth/quickbooks/callback',
        QUICKBOOKS_ENVIRONMENT: 'production'
      },
      max_memory_restart: '512M',
      restart_delay: 5000
    }
  ]
};

