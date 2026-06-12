// ═══════════════════════════════════════════════════════════
// PM2 Ecosystem Configuration
// Run: pm2 start ecosystem.config.js
// ═══════════════════════════════════════════════════════════

module.exports = {
  apps: [
    {
      name: 'tempahan-bilik-media',
      script: './backend/src/server.js',
      cwd: __dirname,
      instances: 1,             // tukar ke 'max' jika nak cluster mode
      exec_mode: 'fork',        // 'cluster' jika instances > 1

      // Auto-restart
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',

      // Restart strategy
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 3000,

      // Environment
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Kuala_Lumpur'
      },
      env_development: {
        NODE_ENV: 'development',
        TZ: 'Asia/Kuala_Lumpur'
      },

      // Logging
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Graceful reload
      kill_timeout: 5000,
      listen_timeout: 3000,
      wait_ready: false,
    }
  ]
};
