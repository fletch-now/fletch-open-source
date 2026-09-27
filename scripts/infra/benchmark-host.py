#!/usr/bin/env python3
"""Bounded, offline tool bursts and real CLI sessions against a local fake model.

This produces host evidence, never a claim of successful paid production builds.
Only this run's temporary directories and named containers are removed.
"""
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse
import json
import os
import pwd
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import uuid

assert os.geteuid() == 0
if subprocess.check_output(["docker", "ps", "-q"]).strip():
    raise SystemExit("The executor must be idle before this synthetic benchmark.")
if subprocess.run(["systemctl", "is-active", "--quiet", "fletch-model-link.service"]).returncode == 0:
    raise SystemExit("Stop only an unused executor's model relay before installing the local fake provider.")
parser = argparse.ArgumentParser()
parser.add_argument("--machine-id", required=True)
parser.add_argument("--shared-workspaces", action="store_true")
args = parser.parse_args()
assert Path("/etc/machine-id").read_text().strip() == args.machine_id
if args.shared_workspaces:
    account = pwd.getpwnam("fletch")
    os.initgroups("fletch", account.pw_gid)
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
IMAGE = os.environ.get("FORGE_AGENT_IMAGE", "fletch-agent:latest")
RUN = "fletch-probe-" + uuid.uuid4().hex[:8]
ROOT = Path(tempfile.mkdtemp(prefix=RUN + "-", dir="/var/lib/fletch/workspaces" if args.shared_workspaces else "/var/lib/fletch"))
ROOT.chmod(0o755)
CGROUP = Path("/sys/fs/cgroup/fletch.slice/fletch-builds.slice")
report = {"image": IMAGE, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "phases": []}
stop = threading.Event()
samples = []
containers = set()
lock = threading.Lock()
requests = 0
ready = threading.Event()
release = threading.Event()

def sample() -> None:
    while not stop.wait(0.25):
        available = next(int(line.split()[1]) * 1024 for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith("MemAvailable:"))
        samples.append({"memoryBytes": int((CGROUP / "memory.current").read_text()), "availableBytes": available})

def container(index: str, kind: str) -> dict:
    directory = ROOT / index
    directory.mkdir()
    home = directory / ".agent-home"
    home.mkdir()
    if kind == "cli":
        config = home / ".kimi-code"
        config.mkdir()
        (config / "config.toml").write_text('default_model = "forge/selected-model"\n[thinking]\nenabled = false\n[providers.forge]\ntype = "kimi"\nbase_url = "http://172.17.0.1:3902/v1"\napi_key = "local-fake-token"\n[models."forge/selected-model"]\nprovider = "forge"\nmodel = "selected-model"\nmax_context_size = 131072\ncapabilities = ["tool_use"]\n')
        command = ["kimi", "--output-format", "stream-json", "-p", "Reply with the local marker and finish."]
        marker = "LOCAL_OFFLOAD_OK"
    elif kind == "forge":
        (directory / "src").mkdir()
        (directory / "test").mkdir()
        (directory / "foundry.toml").write_text('[profile.default]\nsrc="src"\nout="out"\nsolc="0.8.28"\noptimizer=true\noptimizer_runs=200\n')
        methods = "\n".join(f"function value{i}(uint n) public pure returns(uint) {{ return n + {i}; }}" for i in range(250))
        (directory / "src/Fixture.sol").write_text("// SPDX-License-Identifier: MIT\npragma solidity ^0.8.28; contract Fixture {" + methods + "}")
        (directory / "test/Fixture.t.sol").write_text('pragma solidity ^0.8.28; import "../src/Fixture.sol"; contract FixtureTest { function testValue() public { Fixture fixture=new Fixture(); require(fixture.value249(1)==250); } }')
        command = ["forge", "test", "--offline", "--threads", "1"]
        marker = "1 tests passed"
    else:
        (directory / "src").mkdir()
        (directory / "index.html").write_text('<html><div id="root"></div><script type="module" src="/src/main.tsx"></script></html>')
        (directory / "src/main.tsx").write_text('import {createRoot} from "react-dom/client"; import {DataProvider} from "../fletch/data-provider"; import "../fletch/tokens.css"; createRoot(document.getElementById("root")!).render(<DataProvider><h1>Offload fixture</h1></DataProvider>);')
        (directory / "vite.config.mts").write_text('import {defineConfig} from "vite"; import react from "@vitejs/plugin-react"; export default defineConfig({plugins:[react()],base:"./"});')
        command = ["sh", "-c", "ln -s /opt/webapp/node_modules node_modules; node /opt/webapp/build.mjs"]
        marker = "built in"
    for path in [directory, *directory.rglob("*")]:
        os.chown(path, 999, 982)
    name = RUN + "-" + index
    with lock:
        containers.add(name)
    args = ["docker", "run", "--rm", "--name", name, "--user", "999:982", "--cap-drop=ALL", "--security-opt=no-new-privileges",
            "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--memory=2g", "--memory-swap=2g", "--cpus=1.5",
            "--pids-limit=256", "--cgroup-parent=fletch-builds.slice", "--network", "bridge" if kind == "cli" else "none",
            "--mount", f"type=bind,src={directory},dst=/work", "-w", "/work", "-e", "HOME=/work/.agent-home", IMAGE, *command]
    started = time.monotonic()
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=180)
        passed = result.returncode == 0 and marker in result.stdout
        return {"kind": kind, "passed": passed, "seconds": round(time.monotonic() - started, 2),
                "output": result.stdout[-2500:] if not passed else marker}
    finally:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with lock:
            containers.discard(name)

class Provider(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        pass

    def do_POST(self) -> None:
        global requests
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        with lock:
            requests += 1
            if requests == 20:
                ready.set()
        if not release.wait(140):
            self.send_error(504)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        chunk = {"id": "fixture", "model": "selected-model", "object": "chat.completion.chunk", "created": 1,
                 "choices": [{"index": 0, "delta": {"role": "assistant", "content": "LOCAL_OFFLOAD_OK"}, "finish_reason": None}]}
        self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
        chunk["choices"] = [{"index": 0, "delta": {}, "finish_reason": "stop"}]
        self.wfile.write(("data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n").encode())

server = ThreadingHTTPServer(("172.17.0.1", 3902), Provider)
threading.Thread(target=server.serve_forever, daemon=True).start()
threading.Thread(target=sample, daemon=True).start()
try:
    for count in [3, 6, 10, 20]:
        samples.clear()
        before = (CGROUP / "memory.events").read_text()
        with ThreadPoolExecutor(max_workers=count) as executor:
            results = list(executor.map(lambda index: container(f"tools-{count}-{index}", "vite" if index % 2 else "forge"), range(count)))
        phase = {"name": f"{count} offline tools", "results": results, "peakBytes": max(item["memoryBytes"] for item in samples),
                 "minimumAvailableBytes": min(item["availableBytes"] for item in samples), "memoryEventsBefore": before, "memoryEventsAfter": (CGROUP / "memory.events").read_text()}
        report["phases"].append(phase)
        print(json.dumps({key: value for key, value in phase.items() if key != "results"}), flush=True)
        assert all(item["passed"] for item in results), "Offline tool burst failed; higher concurrency was not attempted."
        assert phase["minimumAvailableBytes"] > 5 * 1024 ** 3, "Host reserve crossed; stopped ramp."
    samples.clear()
    with ThreadPoolExecutor(max_workers=26) as executor:
        clients = [executor.submit(container, f"cli-{index}", "cli") for index in range(20)]
        try:
            assert ready.wait(75), "Not all twenty installed CLI processes reached the local provider."
            tools = [executor.submit(container, f"mixed-{index}", "vite" if index % 2 else "forge") for index in range(6)]
            results = [future.result() for future in tools]
        finally:
            release.set()
        results += [future.result() for future in clients]
    report["phases"].append({"name": "20 resident CLI sessions plus six tools", "results": results, "requests": requests,
                             "peakBytes": max(item["memoryBytes"] for item in samples)})
    assert requests == 20 and all(item["passed"] for item in results)
    report["passed"] = True
finally:
    release.set()
    stop.set()
    server.shutdown()
    server.server_close()
    for name in list(containers):
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    shutil.rmtree(ROOT)
    report["limitations"] = "Offline synthetic tool bursts and a local fake provider. No paid-model quota, complete pipeline, 100-build, or sustained availability acceptance."
    report["sharedWorkspaces"] = args.shared_workspaces
    Path("/var/lib/fletch/offload-shared-benchmark.json" if args.shared_workspaces else "/var/lib/fletch/offload-benchmark.json").write_text(json.dumps(report, indent=2) + "\n")
