/**
 * PM2 ecosystem config.
 *
 * Production workflow:
 *   yarn build
 *   pm2 start ecosystem.config.cjs
 *
 * Development (no build needed):
 *   yarn dev       (tsx watch, not managed by PM2)
 */
module.exports = {
  apps: [
    {
      name: "reflect-keeper",
      script: "node",
      args: "dist/index.js",

      // One instance keeps deposits serialised (no double-execution risk)
      instances: 1,
      autorestart: true,
      watch: false,

      // Restart if memory climbs past 256 MB
      max_memory_restart: "256M",

      // Timestamp every log line in PM2's out/err files
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
        // Poll interval in ms — default 60 s; override here or in .env
        SCHEDULER_POLL_INTERVAL_MS: "60000",
      },
    },
  ],
};
