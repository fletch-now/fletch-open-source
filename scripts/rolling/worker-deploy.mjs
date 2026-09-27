import { execFile } from "node:child_process";
import { mkdir, readFile, rmdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs, promisify } from "node:util";
import { workerUnit } from "./worker-unit.mjs";

const exec = promisify(execFile);
const { values } = parseArgs({
  options: {
    id: { type: "string" },
    root: { type: "string" },
    port: { type: "string" },
    "previous-owner": { type: "string" },
    "previous-unit": { type: "string", default: "fletch-build-worker.service" },
    phase: { type: "string" },
  },
});
const { id, root, phase } = values;
const port = Number(values.port);
const previousOwner = values["previous-owner"];
const previousUnit = values["previous-unit"];
const unit = `fletch-build-${id}.service`;
const legacy = previousUnit === "fletch-build-worker.service";
const stateRoot = "/var/lib/fletch/worker-rollouts";
const statePath = `${stateRoot}/${id}.json`;

function check(value, reason) {
  if (!value) throw new Error(reason);
}
async function command(file, args, options = {}) {
  const result = await exec(file, args, {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    ...options,
  });
  return result.stdout.trim();
}
async function pid(name) {
  return command("systemctl", ["show", name, "-p", "MainPID", "--value"]);
}
async function save(state) {
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", {
    mode: 0o600,
  });
}
function report(detail) {
  console.log(JSON.stringify(detail));
}

check(process.getuid() === 0, "Host root required");
check(/^[a-z0-9][a-z0-9-]{5,63}$/.test(id), "Valid release ID required");
check(
  /^build-worker:[a-f0-9-]{36}$/.test(previousOwner),
  "Exact previous worker owner required",
);
check(
  /^fletch-build-[a-z0-9-]+\.service$/.test(previousUnit),
  "Invalid previous worker unit",
);
check(unit !== previousUnit, "Use a new worker generation");
check(
  ["start", "retire"].includes(phase),
  "Use --phase=start or --phase=retire",
);
const definition = workerUnit(root, port);
const require = createRequire(root + "/package.json");
const configured = require("dotenv").parse(
  await readFile("/etc/fletch/fletch.env"),
);
const pool = new (require("pg").Pool)({
  connectionString: configured.DATABASE_URL,
  max: 1,
  statement_timeout: 10000,
});
const env = { ...process.env, ...configured };

async function running() {
  const result = await pool.query(
    "select count(*)::integer as n from build_worker_jobs where owner_id=$1 and state='running'",
    [previousOwner],
  );
  return Number(result.rows[0].n);
}
async function maintenance(action) {
  const result = await command(
    "/usr/bin/node",
    [
      "--import",
      "tsx",
      "scripts/build-maintenance.ts",
      action,
      "--operation-id",
      "retire-" + id,
      "--operator",
      "rolling-worker-operator",
      "--reason",
      "Retire an idle previous worker; preserve active jobs on the next worker",
    ],
    { cwd: root, env },
  );
  return JSON.parse(result);
}
async function installUnit() {
  const path = "/etc/systemd/system/" + unit;
  try {
    await writeFile(path, definition, { flag: "wx", mode: 0o644 });
  } catch (error) {
    if (
      error.code !== "EEXIST" ||
      (await readFile(path, "utf8")) !== definition
    )
      throw error;
  }
  await command("systemctl", ["daemon-reload"]);
}
async function start() {
  const priorState = await readFile(statePath, "utf8").catch(
    function absent(error) {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  check(
    priorState === null,
    "This rollout already has a record; inspect it before continuing",
  );
  const active = await command("systemctl", [
    "list-units",
    "--type=service",
    "--state=running",
    "--plain",
    "--no-legend",
    "fletch-build-*.service",
  ]);
  for (const line of active.split("\n").filter(Boolean)) {
    const name = line.trim().split(/\s+/)[0];
    if (name === unit) continue;
    const configuration = await command("systemctl", ["cat", name]);
    const activePort =
      configuration.match(/^Environment=FORGE_PROXY_PORT=(\d+)$/m)?.[1] ??
      configured.FORGE_PROXY_PORT;
    check(
      Number(activePort) !== port,
      "The proxy slot still belongs to a running worker",
    );
  }
  const previousPid = await pid(previousUnit);
  check(
    /^[1-9][0-9]*$/.test(previousPid),
    "Previous worker must remain running",
  );
  const previousDefinition = await command("systemctl", ["cat", previousUnit]);
  const occupiedPort =
    previousDefinition.match(/^Environment=FORGE_PROXY_PORT=(\d+)$/m)?.[1] ??
    configured.FORGE_PROXY_PORT;
  check(Number(occupiedPort) !== port, "Use the unoccupied proxy slot");
  if (!legacy)
    check(
      previousDefinition.includes("Restart=on-failure"),
      "Previous worker must support retirement without restarting",
    );
  await installUnit();
  await command("systemctl", ["enable", "--now", unit]);
  const nextPid = await pid(unit);
  check(/^[1-9][0-9]*$/.test(nextPid), "Next worker did not start");
  for (let attempt = 0; attempt < 4; attempt++) {
    await delay(5000);
    check((await pid(unit)) === nextPid, "Next worker restarted");
    check(
      (await pid(previousUnit)) === previousPid,
      "Previous worker was interrupted",
    );
  }
  const state = {
    at: new Date().toISOString(),
    id,
    root,
    port,
    unit,
    previousUnit,
    previousOwner,
    previousPid,
    nextPid,
    phase: "both-running",
  };
  await save(state);
  // The bootstrap worker predates SIGUSR2 support. It stays running until idle.
  if (!legacy) {
    await command("systemctl", ["disable", previousUnit]);
    await command("systemctl", [
      "kill",
      "--kill-whom=main",
      "--signal=SIGUSR2",
      previousUnit,
    ]);
    await save({ ...state, phase: "previous-draining" });
  }
  report({
    phase: legacy ? "both-running" : "previous-draining",
    unit,
    nextPid,
    previousPid,
    previousJobs: await running(),
    servicesStopped: 0,
  });
}
async function retireIdle(state) {
  check(
    (await pid(previousUnit)) === state.previousPid,
    "Previous worker identity changed",
  );
  await command("systemctl", ["disable", previousUnit]);
  await command("systemctl", ["stop", previousUnit], { timeout: 120000 });
  check(
    (await pid(unit)) === state.nextPid,
    "Next worker changed during retirement",
  );
  await save({
    ...state,
    phase: "previous-retired",
    retiredAt: new Date().toISOString(),
  });
  report({
    phase: "previous-retired",
    activeWorker: unit,
    activePid: state.nextPid,
    activeJobsPreserved: true,
  });
}
async function retire() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  check(
    state.previousOwner === previousOwner &&
      state.previousUnit === previousUnit &&
      state.root === root &&
      state.port === port,
    "Retirement identity changed",
  );
  check(
    (await pid(unit)) === state.nextPid,
    "Next worker changed before retirement",
  );
  const jobs = await running();
  if (jobs > 0) {
    report({ phase: "waiting-for-previous-jobs", jobs });
    process.exitCode = 3;
    return;
  }
  if (!legacy) {
    check(
      (await pid(previousUnit)) === "0",
      "Previous worker has not finished draining",
    );
    await save({
      ...state,
      phase: "previous-retired",
      retiredAt: new Date().toISOString(),
    });
    report({
      phase: "previous-retired",
      activeWorker: unit,
      activePid: state.nextPid,
      maintenanceUsed: false,
    });
    return;
  }
  // The claim barrier closes the bootstrap worker's idle-count/next-claim race.
  const held = await maintenance("begin");
  check(held.operationId === "retire-" + id, "Foreign maintenance owner");
  try {
    if ((await running()) > 0) {
      report({ phase: "previous-worker-claimed-before-hold" });
      process.exitCode = 3;
      return;
    }
    await retireIdle(state);
  } finally {
    await maintenance("clear");
  }
}

await mkdir(stateRoot, { recursive: true, mode: 0o700 });
await mkdir(`${stateRoot}/apply-lock`, { mode: 0o700 });
try {
  if (phase === "start") await start();
  else await retire();
} finally {
  await pool.end();
  await rmdir(`${stateRoot}/apply-lock`);
}
