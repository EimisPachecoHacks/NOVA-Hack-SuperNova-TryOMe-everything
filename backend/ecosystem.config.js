module.exports = {
  apps: [{
    name: "novatryon",
    script: "./server.js",
    cwd: "/opt/novatryon",
    kill_timeout: 5000,        // 5s grace for SIGTERM before SIGKILL
    treekill: true,            // Kill entire process tree (Python, Chromium children)
    wait_ready: true,          // Wait for process.send('ready')
    listen_timeout: 15000,     // 15s max to wait for ready signal
    max_restarts: 10,          // Stop crash loop after 10 fails
    min_uptime: "10s",         // Must run 10s to count as started
    max_memory_restart: "350M",
    // Reload nginx after restart to drop stale upstream connections
    post_update: ["sudo nginx -s reload"],
    env: {
      NODE_ENV: "production",
    },
  }],
};
