#!/usr/bin/env python3
"""Install one narrow peer route; private keys stay on their originating host."""
import argparse
import base64
import ipaddress
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--machine-id", required=True)
parser.add_argument("--address", required=True)
parser.add_argument("--peer-address", required=True)
parser.add_argument("--peer-public-ip", required=True)
parser.add_argument("--peer-key", required=True)
args = parser.parse_args()
assert os.geteuid() == 0
assert Path("/etc/machine-id").read_text().strip() == args.machine_id
network = ipaddress.ip_network("10.77.0.0/30")
assert ipaddress.ip_address(args.address) in list(network.hosts())
assert ipaddress.ip_address(args.peer_address) in list(network.hosts())
assert args.address != args.peer_address
assert ipaddress.ip_address(args.peer_public_ip).version == 4
assert len(base64.b64decode(args.peer_key, validate=True)) == 32
key = Path("/etc/wireguard/fletch.key").read_text().strip()
config = f"""[Interface]
Address = {args.address}/30
ListenPort = 51820
PrivateKey = {key}
MTU = 1380

[Peer]
PublicKey = {args.peer_key}
AllowedIPs = {args.peer_address}/32
Endpoint = {args.peer_public_ip}:51820
PersistentKeepalive = 25
"""
destination = Path("/etc/wireguard/wg-fletch.conf")
if destination.exists() and destination.read_text() != config:
    raise SystemExit("Existing WireGuard configuration differs; review before replacing it.")
if not destination.exists():
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(config)
subprocess.run(["systemctl", "enable", "--now", "wg-quick@wg-fletch"], check=True)
subprocess.run(["ufw", "allow", "in", "on", "wg-fletch", "proto", "tcp", "from",
                args.peer_address, "to", args.address, "port", "22", "comment", "Fletch private SSH"], check=True)
print("WireGuard enabled with one peer /32 route; default route preserved.")
