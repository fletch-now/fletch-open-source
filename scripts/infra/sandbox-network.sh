#!/usr/bin/env bash
# Install only on the new build host. Keep containers away from the private peers.
set -euo pipefail
expected=${1:?Pass the expected executor machine identity}
[[ $EUID == 0 && $(cat /etc/machine-id) == "$expected" ]]
iptables -N FLETCH-SANDBOX 2>/dev/null || iptables -L FLETCH-SANDBOX -n >/dev/null
for destination in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16; do
  iptables -C FLETCH-SANDBOX -d "$destination" -j REJECT 2>/dev/null || iptables -A FLETCH-SANDBOX -d "$destination" -j REJECT
done
iptables -C DOCKER-USER -i docker0 -j FLETCH-SANDBOX 2>/dev/null || iptables -I DOCKER-USER 1 -i docker0 -j FLETCH-SANDBOX
# Host services are reached through INPUT rather than DOCKER-USER.
iptables -N FLETCH-SANDBOX-HOST 2>/dev/null || iptables -L FLETCH-SANDBOX-HOST -n >/dev/null
iptables -C FLETCH-SANDBOX-HOST -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || iptables -A FLETCH-SANDBOX-HOST -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -C FLETCH-SANDBOX-HOST -d 172.17.0.1 -p tcp --dport 3902 -j ACCEPT 2>/dev/null || iptables -A FLETCH-SANDBOX-HOST -d 172.17.0.1 -p tcp --dport 3902 -j ACCEPT
iptables -C FLETCH-SANDBOX-HOST -d 172.17.0.1 -p tcp --dport 3903 -j ACCEPT 2>/dev/null || iptables -I FLETCH-SANDBOX-HOST 2 -d 172.17.0.1 -p tcp --dport 3903 -j ACCEPT
iptables -C FLETCH-SANDBOX-HOST -d 172.17.0.1 -p tcp --dport 3904 -j ACCEPT 2>/dev/null || iptables -I FLETCH-SANDBOX-HOST 2 -d 172.17.0.1 -p tcp --dport 3904 -j ACCEPT
iptables -C FLETCH-SANDBOX-HOST -j REJECT 2>/dev/null || iptables -A FLETCH-SANDBOX-HOST -j REJECT
iptables -C INPUT -i docker0 -j FLETCH-SANDBOX-HOST 2>/dev/null || iptables -I INPUT 1 -i docker0 -j FLETCH-SANDBOX-HOST
