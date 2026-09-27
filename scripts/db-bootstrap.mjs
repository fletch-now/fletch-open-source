import { config } from "dotenv";
import { Pool } from "pg";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

config({ path: ".env.local", quiet: true });
const url = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
  throw new Error("Bootstrap accepts a local empty database only. Use the reviewed migration procedure for a server database.");
}
const pool = new Pool({ connectionString: url.href });
try {
  const { rows } = await pool.query("select tablename from pg_tables where schemaname = 'public'");
  if (rows.length) throw new Error("Database already contains tables. Bootstrap never modifies an existing installation.");
  const result = spawnSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "push", "--force"], { stdio: "inherit", env: process.env });
  if (result.status !== 0) throw new Error("Schema creation failed. Inspect the disposable database before retrying.");
  // Drizzle's schema push does not create these SQL triggers and constraints.
  for (const file of ["0046_byok_selection.sql", "0057_build_pricing.sql", "0058_registry_quote_observation.sql", "0066_site_drafts.sql", "0067_app_directory.sql", "0070_listing_slugs.sql"]) {
    await pool.query(await readFile(`drizzle/${file}`, "utf8"));
  }
  console.log("Fresh database initialized with current schema and immutable build/billing invariants.");
} finally {
  await pool.end();
}
