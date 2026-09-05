module.exports = {
  apps: [{
    name: "cybertronian-api",
    script: "start.sh",
    cwd: "/home/ubuntu/cybertronian-club",
    env: { NODE_ENV: "production" },
    max_memory_restart: "700M",
    autorestart: true,
    exp_backoff_restart_delay: 100
  }]
};
