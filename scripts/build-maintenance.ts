import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { config as loadEnv } from "dotenv";
import { Pool, type PoolClient } from "pg";
import { BUILD_CLAIM_LOCK } from "../lib/build/capacity";
import { BUILD_MAINTENANCE_KEY, parseBuildMaintenance, type BuildMaintenanceRecord } from "../lib/build/maintenance";

type Command = "status" | "begin" | "heartbeat" | "phase" | "clear";
export interface MaintenanceCommand {
  command: Command;
  operationId?: string;
  phase?: "draining" | "updating";
  leaseSeconds?: number;
  operator?: string;
  reason?: string;
}
class MaintenanceError extends Error {}
async function verifyPublicationHelper(): Promise<void> {
  try {
    await promisify(execFile)("/usr/bin/python3", ["-I", fileURLToPath(new URL("./install-publish-helper.py", import.meta.url)), "check"], {
      env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", NODE_ENV: "production" }, timeout: 18000, maxBuffer: 4096,
    });
  } catch {
    throw new MaintenanceError("Publication helper verification failed; maintenance remains held. Run /usr/bin/python3 -I scripts/install-publish-helper.py check as host root before retrying.");
  }
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new MaintenanceError(message);
}
function storedRecord(value: string | undefined): BuildMaintenanceRecord | null {
  if (value === undefined) return null;
  const snapshot = parseBuildMaintenance(value);
  check(snapshot?.startedAt !== null && snapshot?.startedAt !== undefined, "Malformed maintenance hold requires reviewed database repair; it remains held.");
  return JSON.parse(value) as BuildMaintenanceRecord;
}
async function status(client: PoolClient) {
  const saved = await client.query<{ value: string }>("select value from app_settings where key=$1", [BUILD_MAINTENANCE_KEY]);
  const value = saved.rows[0]?.value;
  const maintenance = parseBuildMaintenance(value);
  // Never print malformed raw settings: they may contain unrelated private data.
  const operationId = maintenance?.startedAt ? (JSON.parse(value) as BuildMaintenanceRecord).operationId : null;
  const work = await client.query(`select
    count(*) filter(where b.status::text='queued')::int as queued,
    count(*) filter(where b.status::text in ('provisioning','building','compiling'))::int as executing,
    count(*) filter(where j.state='running')::int as running,
    count(*) filter(where j.state='recovery_required')::int as reserved,
    count(*) filter(where j.state='paused_budget')::int as "budgetPaused"
    from builds b left join build_worker_jobs j on j.build_id=b.id`);
  return { held: value !== undefined, operationId, maintenance, work: work.rows[0] };
}

// This function owns its transaction; a failed audit cannot leave an unaudited hold.
export async function executeMaintenance(pool: Pool, input: MaintenanceCommand, verifyPublication: () => Promise<void> = verifyPublicationHelper) {
  check(["status", "begin", "heartbeat", "phase", "clear"].includes(input.command), "Unknown maintenance command.");
  if (input.command !== "status") {
    check(typeof input.operationId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(input.operationId), "Supply a stable operation ID (1 to 128 letters, digits, dots, colons, underscores or hyphens).");
    check(typeof input.operator === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.@:-]{0,127}$/.test(input.operator), "Supply an identified operator.");
    if (input.command !== "heartbeat") check(typeof input.reason === "string" && input.reason.trim().length >= 4 && input.reason.trim().length <= 200, "Supply a reason containing 4 to 200 characters.");
  }
  const seconds = input.leaseSeconds ?? 300;
  check(Number.isInteger(seconds) && seconds >= 60 && seconds <= 3600, "Heartbeat freshness must be 60 to 3600 seconds.");
  if (input.command === "phase") check(input.phase === "draining" || input.phase === "updating", "Phase must be draining or updating.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (input.command === "status") {
      const result = await status(client);
      await client.query("commit");
      return { command: input.command, changed: false, ...result };
    }
    await client.query("select pg_advisory_xact_lock($1)", [BUILD_CLAIM_LOCK]);
    const saved = await client.query<{ value: string }>("select value from app_settings where key=$1 for update", [BUILD_MAINTENANCE_KEY]);
    const previous = storedRecord(saved.rows[0]?.value);
    check(!previous || previous.operationId === input.operationId, "Another operation owns the maintenance hold; no change was made.");
    const now = (await client.query<{ now: Date }>("select clock_timestamp() as now")).rows[0].now;
    const timestamp = now.toISOString();
    let next = previous;
    let changed = false;
    if (input.command === "clear") {
      if (previous) {
        await verifyPublication();
        await client.query("delete from app_settings where key=$1", [BUILD_MAINTENANCE_KEY]); next = null; changed = true;
      }
    } else if (input.command === "begin" && previous) {
      // A repeated begin is an acknowledgement, not a takeover or phase reset.
    } else {
      check(input.command === "begin" || previous, "No maintenance hold exists for this operation.");
      next = {
        version: 1, operationId: input.operationId!, phase: input.command === "phase" ? input.phase! : previous?.phase ?? "draining",
        startedAt: previous?.startedAt ?? timestamp, heartbeatAt: timestamp,
        expiresAt: new Date(now.getTime() + seconds * 1000).toISOString(),
      };
      await client.query(`insert into app_settings(key,value,updated_by) values($1,$2,$3)
        on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=clock_timestamp()`,
      [BUILD_MAINTENANCE_KEY, JSON.stringify(next), input.operator]);
      changed = true;
    }
    if (changed && input.command !== "heartbeat") await client.query(`insert into audit_log(id,user_id,actor_type,action,resource_type,resource_id,metadata)
      values($1,null,'user',$2,'setting',$3,$4)`, [`al_${randomUUID()}`, `admin.build.maintenance.${input.command}`, BUILD_MAINTENANCE_KEY,
      JSON.stringify({ operator: input.operator, reason: input.reason!.trim(), previous, next })]);
    const result = await status(client);
    await client.query("commit");
    return { command: input.command, changed, ...result };
  } catch (cause) { await client.query("rollback"); throw cause; } finally { client.release(); }
}

async function main() {
  check(process.getuid?.() === 0, "Run the operator command as host root.");
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    "operation-id": { type: "string" }, operator: { type: "string" }, reason: { type: "string" },
    phase: { type: "string" }, "lease-seconds": { type: "string" },
  } });
  check(positionals.length <= 1, "Supply one maintenance command.");
  for (const path of ["/etc/fletch/fletch.env", ".env.local"]) if (existsSync(path)) loadEnv({ path, quiet: true });
  check(process.env.DATABASE_URL, "Database configuration is missing.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, query_timeout: 15000, statement_timeout: 10000 });
  try {
    const result = await executeMaintenance(pool, {
      command: (positionals[0] ?? "status") as Command, operationId: values["operation-id"], operator: values.operator,
      reason: values.reason, phase: values.phase as MaintenanceCommand["phase"],
      leaseSeconds: values["lease-seconds"] === undefined ? undefined : Number(values["lease-seconds"]),
    });
    console.log(JSON.stringify(result));
  } finally { await pool.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ ok: false, error: error instanceof MaintenanceError ? error.message : "Maintenance command failed; inspect service health before retrying. Existing holds remain authoritative." }));
    process.exitCode = 1;
  });
}
