module.exports = {
  apps: [
    {
      name: 'tally-relay',
      script: 'relay.js',
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      cron_restart: '0 6 * * *',
      out_file: './logs/relay-out.log',
      error_file: './logs/relay-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: {
        VPS_URL: 'wss://your-vps-domain.com/tally-relay',
        TALLY_PORT: '9000',
      },
    },
  ],
};
