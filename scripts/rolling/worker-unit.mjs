// Proxy slots let the next worker accept jobs while the old worker finishes.
export function workerUnit(root, port) {
  if (
    !/^\/opt\/fletch\/[a-zA-Z0-9/_-]+$/.test(root) ||
    root.includes("..") ||
    ![3902, 3903, 3904].includes(port)
  )
    throw Error("Invalid worker release or proxy slot");
  return `[Unit]
Description=Fletch build worker on proxy slot ${port}
After=postgresql.service network-online.target fletch-executor-control.service
Wants=network-online.target fletch-executor-control.service

[Service]
User=fletch
EnvironmentFile=/etc/fletch/fletch.env
EnvironmentFile=-/etc/fletch/build-database.env
Environment=PGPOOL_MAX=8
Environment=PGAPPNAME=fletch-build-${port}
Environment=FORGE_PROXY_PORT=${port}
WorkingDirectory=${root}
ExecStart=/usr/bin/node --conditions=react-server --import tsx workers/build.ts
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=180
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/fletch/workspaces /var/lib/fletch/sites /etc/letsencrypt /var/log/letsencrypt /var/lib/letsencrypt /etc/nginx/apps-certs
ProtectHome=true

[Install]
WantedBy=multi-user.target
`;
}
