#!/usr/bin/env python3
"""Non-secret host identity, limits and live pressure for remote admission."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

cgroup = Path('/sys/fs/cgroup/fletch.slice/fletch-builds.slice')
memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
quota, period = (cgroup / 'cpu.max').read_text().split()
mount = json.loads(subprocess.check_output(['findmnt', '--json', '--mountpoint', '/var/lib/fletch/workspaces'], timeout=3))['filesystems'][0]
assert mount['source'] == '10.77.0.1:/' and mount['fstype'] == 'nfs4'
docker = json.loads(subprocess.check_output(['/usr/bin/docker', 'info', '--format', '{{json .}}'], timeout=3))
def relay_ready(unit: str, port: int) -> bool:
    active = subprocess.run(['systemctl', 'is-active', '--quiet', unit]).returncode == 0
    listeners = subprocess.check_output(['ss', '-lntH', f'sport = :{port}'], timeout=3).decode()
    return active and f'172.17.0.1:{port}' in listeners


relays_ready = relay_ready('fletch-model-link.service', 3902) and relay_ready('fletch-model-link-next.service', 3903)
print(json.dumps({
    'version': 1,
    'atMs': int(time.time() * 1000),
    'hostId': hashlib.sha256(Path('/etc/machine-id').read_text().strip().encode()).hexdigest(),
    'platform': 'linux',
    'logicalCpus': os.cpu_count(),
    'totalMemoryBytes': int(memory['MemTotal'].split()[0]) * 1024,
    'cgroupParent': 'fletch-builds.slice',
    'cgroupDriver': docker['CgroupDriver'],
    'cgroupCpuQuota': int(quota) / int(period),
    'cgroupMemoryBytes': int((cgroup / 'memory.max').read_text()),
    'sliceMemoryBytes': int((cgroup / 'memory.current').read_text()),
    'hostAvailableBytes': int(memory['MemAvailable'].split()[0]) * 1024,
    'memoryEvents': dict((name, int(value)) for name, value in
                         (line.split() for line in (cgroup / 'memory.events').read_text().splitlines())),
    'workspaceMounted': True,
    'modelRelayReady': relays_ready,
}))
