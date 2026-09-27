// Run on the hosting server. The candidate is already built in its own release directory.
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  lstat,
  copyFile,
  rename,
  rm,
  realpath,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  validateRelease,
  releaseUnit,
  upstreamConfig,
  switchProxyConfig,
  bytesHash,
  isRegistryChangesPage,
} from "./web-config.mjs";

const exec = promisify(execFile);
async function command(file, args) {
  return (
    await exec(file, args, { timeout: 30000, maxBuffer: 1024 * 1024 })
  ).stdout.trim();
}
function check(value, reason) {
  if (!value) throw Error(reason);
}
async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function atomic(path, text, mode = 0o644) {
  const temporary = `${path}.next-${process.pid}`;
  await writeFile(temporary, text, { mode });
  await rename(temporary, path);
}
const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const i = arg.indexOf("=");
    return [arg.slice(0, i), arg.slice(i + 1)];
  }),
);
check(
  Object.keys(options).every((key) =>
    ["--id", "--root", "--port", "--apply"].includes(key),
  ),
  "Unknown release argument",
);
const release = {
  id: options["--id"],
  root: options["--root"],
  port: Number(options["--port"]),
};
validateRelease(release);
check(process.getuid() === 0, "Host root required");
const apply = options["--apply"] === "yes";
const stateRoot = "/var/lib/fletch/web-rollouts";
// Keep only the two newest releases available for reconnecting existing tabs.
// Older Next servers are retired after traffic switches; retaining them
// indefinitely exhausts host memory even though nginx never sends new traffic.
const RETAINED_RELEASE_LIMIT = 2;
const configPaths = [
  "/etc/nginx/conf.d/fletch-web-upstream.conf",
  "/etc/nginx/sites-enabled/fletch",
  "/etc/nginx/snippets/fletch-public-api.conf",
];
configPaths[1] = await realpath(configPaths[1]);
const unit = `fletch-web-${release.id}.service`;
const activeWorkers = await command("systemctl", [
  "list-units",
  "--type=service",
  "--state=running",
  "--plain",
  "--no-legend",
  "fletch-build-*.service",
]);
const protectedUnits = [
  "fletch.service",
  "fletch-executor-control.service",
  ...activeWorkers
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/)[0]),
];
check(protectedUnits.length > 2, "An independent build worker must be running");
async function processes() {
  return Promise.all(
    protectedUnits.map(async function processIdentity(name) {
      return {
        name,
        pid: await command("systemctl", [
          "show",
          name,
          "-p",
          "MainPID",
          "--value",
        ]),
      };
    }),
  );
}
async function health(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/health?deep=1`, {
    signal: AbortSignal.timeout(15_000),
  });
  check(response.ok, `Health failed at ${port}`);
  await response.body.cancel();
}
async function retainStatic(from, destination, prefix = "") {
  for (const name of await readdir(join(from, prefix))) {
    const relative = join(prefix, name),
      source = join(from, relative),
      info = await lstat(source);
    check(!info.isSymbolicLink(), "Static asset links are not accepted");
    const target = join(destination, relative);
    if (info.isDirectory()) {
      await mkdir(target, { recursive: true, mode: 0o755 });
      await retainStatic(from, destination, relative);
      continue;
    }
    check(info.isFile(), "Unexpected static asset kind");
    const old = await readFile(target).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (old)
      check(
        bytesHash(old) === bytesHash(await readFile(source)),
        `Static asset collision: ${relative}`,
      );
    else await copyFile(source, target);
  }
}
const report = { at: new Date().toISOString(), release, apply, steps: [] };
async function record(step, detail = {}) {
  const event = { at: new Date().toISOString(), step, ...detail };
  report.steps.push(event);
  console.log(JSON.stringify(event));
  if (apply)
    await atomic(
      `${stateRoot}/${release.id}.json`,
      JSON.stringify(report, null, 2) + "\n",
      0o600,
    );
}
const before = await processes();
check(
  before.every((entry) => /^[1-9][0-9]*$/.test(entry.pid)),
  "Existing web, worker and executor transport must be running",
);
const ready = await json(`${release.root}/.next/required-server-files.json`);
check(
  ready.config.output === "standalone",
  "A standalone production build is required",
);
check(
  ready.config.deploymentId === release.id,
  "Build deployment ID must match the release",
);
await lstat(`${release.root}/.next/standalone/server.js`);
const previous = await json(`${stateRoot}/current.json`).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
check(previous?.release.id !== release.id, "Release is already active");
const allRetained = previous
  ? [...(previous.retained ?? []), previous.release]
  : [];
const retired = allRetained.slice(0, -RETAINED_RELEASE_LIMIT);
const retained = allRetained.slice(-RETAINED_RELEASE_LIMIT);
check(
  !retained.some(
    (entry) => entry.port === release.port || entry.root === release.root,
  ),
  "Use a fresh release path and port",
);
await health(previous?.release.port ?? 3000);
if (apply) await mkdir(stateRoot, { recursive: true, mode: 0o700 });
await record("candidate_reviewed", {
  buildId: (await readFile(`${release.root}/.next/BUILD_ID`, "utf8")).trim(),
  preserved: before,
  retained: retained.length,
});
if (!apply) process.exit(0);
await mkdir(stateRoot, { recursive: true, mode: 0o700 });
await mkdir(`${stateRoot}/apply-lock`, { mode: 0o700 });
let switched = false;
const backup = new Map();
try {
  for (const path of configPaths)
    backup.set(
      path,
      await readFile(path, "utf8").catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    );
  await atomic(
    `${stateRoot}/${release.id}-nginx-before.json`,
    JSON.stringify(Object.fromEntries(backup), null, 2) + "\n",
    0o600,
  );
  await atomic(`/etc/systemd/system/${unit}`, releaseUnit(release));
  await command("systemctl", ["daemon-reload"]);
  await command("systemctl", ["start", unit]);
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await health(release.port);
      break;
    } catch (error) {
      if (attempt === 29) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const candidatePid = await command("systemctl", [
    "show",
    unit,
    "-p",
    "MainPID",
    "--value",
  ]);
  const preview = await fetch(
    `http://127.0.0.1:${release.port}/registry/changes`,
    { headers: { Host: "builder.example.com" }, signal: AbortSignal.timeout(30000) },
  );
  check(
    preview.ok && isRegistryChangesPage(await preview.text()),
    "Candidate registry page failed",
  );
  await mkdir("/var/lib/fletch/web-static", { recursive: true, mode: 0o755 });
  // Next 16.2 reuses its build ID when deploymentId is set. Preserve each
  // deployment separately so its manifest cannot overwrite an older tab's file.
  if (!previous) await retainStatic("/opt/fletch/app/.next/static", "/var/lib/fletch/web-static");
  for (const version of [...retained, release]) {
    validateRelease(version);
    const destination = `/var/lib/fletch/web-static-versions/${version.id}`;
    await mkdir(destination, { recursive: true, mode: 0o755 });
    await retainStatic(`${version.root}/.next/static`, destination);
  }
  await record("candidate_healthy", {
    pid: candidatePid,
    staticAssetsRetained: true,
  });
  await atomic(configPaths[0], upstreamConfig(release, retained));
  await atomic(
    configPaths[1],
    switchProxyConfig(backup.get(configPaths[1]), true),
  );
  await atomic(
    configPaths[2],
    switchProxyConfig(backup.get(configPaths[2]), false),
  );
  await command("nginx", ["-t"]);
  await command("systemctl", ["reload", "nginx"]);
  switched = true;
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await fetch("https://builder.example.com/registry/changes", {
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    if (response.ok && text.includes(`data-dpl-id="${release.id}"`)) break;
    if (attempt === 14)
      throw Error("Public traffic did not reach the candidate");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await health(release.port);
  check(
    JSON.stringify(await processes()) === JSON.stringify(before),
    "Existing web, build worker or executor transport changed during rollout",
  );
  check(
    (await command("systemctl", ["show", unit, "-p", "MainPID", "--value"])) ===
      candidatePid,
    "Candidate restarted during rollout",
  );
  if (retired.length) {
    const retiredUnits = retired.map((entry) => `fletch-web-${entry.id}.service`);
    await command("systemctl", ["stop", ...retiredUnits]);
    await command("systemctl", ["disable", ...retiredUnits]);
  }
  await command("systemctl", ["enable", unit]);
  await atomic(
    `${stateRoot}/current.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        release,
        retained,
        legacy: { unit: "fletch.service", port: 3000, root: "/opt/fletch/app" },
      },
      null,
      2,
    ) + "\n",
    0o600,
  );
  await record("web_release_live", {
    existingProcessesPreserved: true,
    workerRestarted: false,
    maintenanceUsed: false,
    oldWebRetained: retained.length,
    retiredWebReleases: retired.length,
  });
} catch (error) {
  for (const [path, text] of backup) {
    if (text === null) await rm(path, { force: true });
    else await atomic(path, text);
  }
  await command("nginx", ["-t"]);
  if (switched) await command("systemctl", ["reload", "nginx"]);
  await health(previous?.release.port ?? 3000);
  await record("traffic_retained_or_restored", {
    reason: error.message,
    oldWebRetained: true,
  });
  throw error;
} finally {
  await rm(`${stateRoot}/apply-lock`, { recursive: true });
}
