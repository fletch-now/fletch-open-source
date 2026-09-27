#!/usr/bin/env python3
"""Add a scoped proxy slot while retaining the existing model relay."""
import argparse
import os
from pathlib import Path
import pwd
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("role", choices=["control", "build"])
parser.add_argument("--machine-id", required=True)
parser.add_argument("--port", type=int, choices=[3903, 3904], default=3903)
args = parser.parse_args()
assert os.geteuid() == 0
assert Path("/etc/machine-id").read_text().strip() == args.machine_id
port = args.port
previous_ports = [3902] if port == 3903 else [3902, 3903]


def replace(path: Path, before: str, after: str) -> None:
    text = path.read_text()
    if after in text:
        return
    if text.count(before) != 1:
        raise SystemExit(f"Expected configuration not found: {path}")
    info = path.stat()
    temporary = path.with_name(path.name + ".rolling-next")
    temporary.write_text(text.replace(before, after))
    os.chmod(temporary, info.st_mode & 0o777)
    os.chown(temporary, info.st_uid, info.st_gid)
    temporary.replace(path)


if args.role == "control":
    account = pwd.getpwnam("fletch-model-link")
    authorized = Path(account.pw_dir) / ".ssh/authorized_keys"
    if f'permitopen="172.17.0.1:{port}"' not in authorized.read_text():
        replace(authorized,
                ','.join(f'permitopen="172.17.0.1:{p}"' for p in previous_ports) + ' ',
                ','.join(f'permitopen="172.17.0.1:{p}"' for p in [*previous_ports, port]) + ' ')
    ssh_config = Path("/etc/ssh/sshd_config.d/60-fletch-model-link.conf")
    if f"172.17.0.1:{port}" not in ssh_config.read_text():
        replace(ssh_config,
                "    PermitOpen " + ' '.join(f'172.17.0.1:{p}' for p in previous_ports) + '\n',
                "    PermitOpen " + ' '.join(f'172.17.0.1:{p}' for p in [*previous_ports, port]) + '\n')
    subprocess.run(["/usr/sbin/sshd", "-t"], check=True)
    subprocess.run(["systemctl", "reload", "ssh"], check=True)
else:
    original = Path("/etc/systemd/system/fletch-model-link.service").read_text()
    unit = "fletch-model-link-next.service" if port == 3903 else f"fletch-model-link-{port}.service"
    target = Path("/etc/systemd/system") / unit
    updated = original.replace("172.17.0.1:3902:172.17.0.1:3902", f"172.17.0.1:{port}:172.17.0.1:{port}")
    assert updated != original
    if target.exists() and target.read_text() != updated:
        raise SystemExit("Second model-link unit differs from the reviewed configuration")
    target.write_text(updated)
    os.chmod(target, 0o644)
    rule = ["FLETCH-SANDBOX-HOST", "-d", "172.17.0.1", "-p", "tcp", "--dport", str(port), "-j", "ACCEPT"]
    if subprocess.run(["iptables", "-C", *rule], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        subprocess.run(["iptables", "-I", rule[0], "2", *rule[1:]], check=True)
    script = Path("/usr/local/sbin/fletch-sandbox-network")
    marker = "iptables -C FLETCH-SANDBOX-HOST -j REJECT"
    addition = f"iptables -C FLETCH-SANDBOX-HOST -d 172.17.0.1 -p tcp --dport {port} -j ACCEPT 2>/dev/null || iptables -I FLETCH-SANDBOX-HOST 2 -d 172.17.0.1 -p tcp --dport {port} -j ACCEPT\n"
    if addition not in script.read_text():
        replace(script, marker, addition + marker)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "--now", unit], check=True)
print(f"Scoped proxy slot {port} prepared; existing relays retained.")
