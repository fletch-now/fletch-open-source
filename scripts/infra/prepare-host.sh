#!/usr/bin/env bash
# Prepare networking or an empty build host; this never enables a Fletch worker.
set -euo pipefail
role=${1:?Usage: prepare-host.sh control-or-build expected-machine-id peer-public-ip}
expected=${2:?Expected machine ID required}
peer=${3:?Peer public IPv4 required}
[[ $EUID == 0 && $(cat /etc/machine-id) == "$expected" ]]
[[ $role == control || $role == build ]]
python3 -c 'import ipaddress,sys; assert ipaddress.ip_address(sys.argv[1]).version == 4' "$peer"
if [[ $role == build ]]; then
  # Re-running against an activated host must not restart its Docker daemon.
  [[ ! -e /etc/fletch/fletch.env && ! -e /opt/fletch/build-worker ]]
  [[ ! -e /etc/systemd/system/fletch-model-link.service ]]
fi
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
apt-get update -qq
apt-get install -y --no-install-recommends wireguard-tools iperf3
install -d -m 0700 /etc/wireguard
if [[ ! -e /etc/wireguard/fletch.key ]]; then
  (umask 077; wg genkey > /etc/wireguard/fletch.key)
fi
wg pubkey < /etc/wireguard/fletch.key > /etc/wireguard/fletch.pub
ufw allow proto udp from "$peer" to any port 51820 comment 'Fletch WireGuard peer'
if [[ $role == control ]]; then exit 0; fi
apt-get install -y --no-install-recommends ca-certificates curl rsync nfs-common jq
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod 0644 /etc/apt/keyrings/docker.asc
. /etc/os-release
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update -qq
apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
install -d -m 0755 /etc/docker
if [[ ! -e /etc/docker/daemon.json ]]; then
  cat > /etc/docker/daemon.json <<'EOF'
{"log-driver":"local","log-opts":{"max-size":"10m","max-file":"3"},"live-restore":true}
EOF
  systemctl restart docker
fi
getent group fletch >/dev/null || groupadd --gid 982 fletch
id fletch >/dev/null 2>&1 || useradd --system --uid 999 --gid fletch --home-dir /var/lib/fletch --shell /usr/sbin/nologin fletch
usermod -aG docker fletch
install -d -o fletch -g fletch -m 0750 /var/lib/fletch /var/lib/fletch/workspaces /var/lib/fletch/build-checkpoints
install -d -o fletch -g fletch -m 0755 /var/lib/fletch/sites
install -d -m 0755 /opt/fletch /etc/fletch
ufw allow OpenSSH
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
systemctl enable docker
docker info --format '{{json .ServerVersion}}'
printf 'Host prepared. No application runtime or production worker activated.\n'
