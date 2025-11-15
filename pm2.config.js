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
        NEXT_PUBLIC_BASE_PATH: '/ops'
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
        NEXT_PUBLIC_BASE_PATH: '/ops'
      },
      max_memory_restart: '512M',
      restart_delay: 5000
    }
  ]
};

