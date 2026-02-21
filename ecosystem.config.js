module.exports = {
  apps: [{
    name: 'thefairmap',
    script: 'server.js',
    cwd: '/Users/scoutbot/.openclaw/workspace/thefairmap',
    env: {
      PORT: 4000,
      NODE_ENV: 'production',
      ADMIN_USER: 'admin',
      ADMIN_PASS: 'fairmap2026',
      SESSION_SECRET: 'fairmap-secret-2026-vfm'
    },
    restart_delay: 2000,
    max_restarts: 10
  }]
};
