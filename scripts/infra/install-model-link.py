#!/usr/bin/env python3
"""Prepare a restricted SSH credential-proxy link."""
import argparse
import os
from pathlib import Path
import pwd
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("role", choices=["control", "build"])
parser.add_argument("--machine-id", required=True)
parser.add_argument("--public-key")
parser.add_argument("--host-key")
args = parser.parse_args()
assert os.geteuid() == 0
assert Path("/etc/machine-id").read_text().strip() == args.machine_id
user = "fletch-model-link"
try:
    account = pwd.getpwnam(user)
except KeyError:
    subprocess.run(["useradd", "--system", "--create-home", "--home-dir", "/var/lib/fletch-model-link",
                    "--shell", "/usr/sbin/nologin", user], check=True)
    account = pwd.getpwnam(user)

def write(path: Path, content: str, mode: int, owner: bool = False) -> None:
    if path.exists():
        if path.read_text() != content:
            raise SystemExit(f"Existing configuration differs: {path}")
        return
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(content)
    if owner:
        os.chown(path, account.pw_uid, account.pw_gid)

def key(value: str | None) -> str:
    if not value or not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]+)?", value):
        raise SystemExit("A single Ed25519 public key is required.")
    return " ".join(value.split()[:2])

if args.role == "control":
    public = key(args.public_key)
    directory = Path(account.pw_dir) / ".ssh"
    directory.mkdir(mode=0o700, exist_ok=True)
    os.chown(directory, account.pw_uid, account.pw_gid)
    write(directory / "authorized_keys",
          f'from="10.77.0.2",restrict,port-forwarding,permitopen="172.17.0.1:3902",permitopen="172.17.0.1:3903",permitopen="172.17.0.1:3904" {public}\n', 0o600, True)
    write(Path("/etc/ssh/sshd_config.d/60-fletch-model-link.conf"), """Match User fletch-model-link
    AuthenticationMethods publickey
    PasswordAuthentication no
    AllowTcpForwarding local
    AllowStreamLocalForwarding no
    PermitOpen 172.17.0.1:3902 172.17.0.1:3903 172.17.0.1:3904
    PermitTTY no
    X11Forwarding no
    AllowAgentForwarding no
    PermitTunnel no
    GatewayPorts no
    ForceCommand /usr/bin/false
Match all
""", 0o644)
    subprocess.run(["/usr/sbin/sshd", "-t"], check=True)
    subprocess.run(["systemctl", "reload", "ssh"], check=True)
else:
    directory = Path("/etc/fletch/model-link")
    directory.mkdir(mode=0o750, exist_ok=True)
    os.chown(directory, 0, account.pw_gid)
    identity = directory / "id_ed25519"
    if not identity.exists():
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(identity)], check=True)
        os.chown(identity, account.pw_uid, account.pw_gid)
    if args.host_key:
        write(directory / "known_hosts", f"10.77.0.1 {key(args.host_key)}\n", 0o644)
print("Model-link account prepared; provider keys stay on the control host.")
