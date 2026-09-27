#!/usr/bin/env bash
# One workspace authority stays on the control server; no sites or DB are exported.
set -euo pipefail
role=${1:?control or build}
expected=${2:?Pass the expected machine identity for this role}
if [[ $role == control ]]; then
  [[ $EUID == 0 && $(cat /etc/machine-id) == "$expected" ]]
  if [[ -e /etc/exports.d/fletch.exports ]]; then
    echo 'Workspace export is already installed; use a drained change for reconfiguration.' >&2
    exit 1
  fi
  install -d /etc/nfs.conf.d /etc/exports.d
  cat > /etc/nfs.conf.d/fletch.conf <<'EOF'
[nfsd]
host=10.77.0.1
vers3=n
vers4=y
udp=n
EOF
  cat > /etc/exports.d/fletch.exports <<'EOF'
/var/lib/fletch/workspaces 10.77.0.2(rw,sync,root_squash,no_subtree_check,fsid=0)
EOF
  ufw allow in on wg-fletch proto tcp from 10.77.0.2 to 10.77.0.1 port 2049 comment 'Fletch build workspace NFSv4'
  install -d /etc/systemd/system/nfs-server.service.d
  cat > /etc/systemd/system/nfs-server.service.d/fletch-wireguard.conf <<'EOF'
[Unit]
Requires=wg-quick@wg-fletch.service
After=wg-quick@wg-fletch.service
EOF
  systemctl daemon-reload
  systemctl enable nfs-server
  systemctl restart nfs-server
  exportfs -ra
  exportfs -v
elif [[ $role == build ]]; then
  [[ $EUID == 0 && $(cat /etc/machine-id) == "$expected" ]]
  if ! mountpoint -q /var/lib/fletch/workspaces; then
    [[ -z $(docker ps -q) ]]
    if [[ -n $(find /var/lib/fletch/workspaces -mindepth 1 -maxdepth 1 -print -quit) ]]; then
      install -d -m 0700 /var/lib/fletch/staging-preseed
      [[ ! -e /var/lib/fletch/staging-preseed/workspaces ]]
      mv /var/lib/fletch/workspaces /var/lib/fletch/staging-preseed/workspaces
    fi
    install -d -m 0750 /var/lib/fletch/workspaces
  fi
  cat > /etc/systemd/system/var-lib-fletch-workspaces.mount <<'EOF'
[Unit]
Description=Authoritative Fletch workspaces over WireGuard
Requires=wg-quick@wg-fletch.service
After=network-online.target wg-quick@wg-fletch.service
Before=docker.service

[Mount]
What=10.77.0.1:/
Where=/var/lib/fletch/workspaces
Type=nfs4
Options=rw,hard,vers=4.2,proto=tcp,nodev,nosuid,actimeo=0,lookupcache=none,nconnect=4
TimeoutSec=30

[Install]
WantedBy=multi-user.target
EOF
  install -d /etc/systemd/system/docker.service.d
  cat > /etc/systemd/system/docker.service.d/fletch-workspaces.conf <<'EOF'
[Unit]
Requires=var-lib-fletch-workspaces.mount
After=var-lib-fletch-workspaces.mount
EOF
  systemctl daemon-reload
  systemctl enable --now var-lib-fletch-workspaces.mount
  findmnt /var/lib/fletch/workspaces
else
  exit 64
fi
