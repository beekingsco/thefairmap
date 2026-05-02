// Copy this file to ecosystem.config.js and fill in your values
// ecosystem.config.js is gitignored — NEVER commit real keys
module.exports = {
  apps: [{
    name: 'thefairmap',
    script: 'server.js',
    cwd: '/Users/scoutbot/.openclaw/workspace/thefairmap',
    env: {
      PORT: 4000,
      NODE_ENV: 'production',
      ADMIN_USER: 'admin',
      ADMIN_PASS: 'change-me',
      SESSION_SECRET: 'generate-a-random-string',
      MAPTILER_KEY: '',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_FROM_NUMBER: '',
      RESEND_API_KEY: '',
      FROM_EMAIL: 'hello@thefairmap.com'
    },
    restart_delay: 2000,
    max_restarts: 10
  }]
};
