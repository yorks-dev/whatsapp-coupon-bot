module.exports = {
  apps: [
    {
      name: "coupon-bot",
      script: "src/index.js",
      cwd: "/Users/ayushdutta/dev/whatsapp-coupon-bot",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "coupon-control",
      script: "src/control-server.js",
      cwd: "/Users/ayushdutta/dev/whatsapp-coupon-bot",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
        CONTROL_HOST: "0.0.0.0",
        CONTROL_PORT: "8788"
      }
    }
  ]
};
