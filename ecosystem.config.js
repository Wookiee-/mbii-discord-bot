module.exports = {
  apps: [{
    name: 'mbii-bot',
    script: 'bot.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    kill_timeout: 5000,
    watch: false
  }]
};