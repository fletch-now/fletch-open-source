import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { createSourceBackup } from "../lib/ops/source-backup";

process.umask(0o077);
const config = parseEnv(await readFile(process.env.FLETCH_ENV_FILE ?? "/etc/fletch/fletch.env", "utf8"));
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000 });
try {
  if (!config.FORGE_WORKSPACE_ROOT || !config.FORGE_CHECKPOINT_ROOT) throw new Error("Missing persistent source paths.");
  const receipt = await createSourceBackup({ pool, workspaceRoot: config.FORGE_WORKSPACE_ROOT,
    checkpointRoot: config.FORGE_CHECKPOINT_ROOT, destination: process.env.FLETCH_SOURCE_BACKUP_DEST ?? "/var/backups/fletch",
    forbiddenValues: Object.entries(config).flatMap(function secret([name, value]) { return value && /SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY/.test(name) ? [value] : []; }),
  });
  console.log(JSON.stringify({ event: "source_backup_verified", ...receipt }));
} catch {
  console.error(JSON.stringify({ event: "source_backup_failed" }));
  process.exitCode = 1;
} finally { await pool.end(); }
