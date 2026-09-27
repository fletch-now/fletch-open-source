// Run on the build server. Transfer .next and release-ready.json to the hosting
// server afterwards. Runtime credentials and database access are not required.
import { execFile } from "node:child_process";
import { access, cp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseArgs, promisify } from "node:util";
import { validateRelease } from "./web-config.mjs";

const { values } = parseArgs({ options: {
  id: { type: "string" }, root: { type: "string" }, port: { type: "string" },
  commit: { type: "string" }, config: { type: "string" }, retry: { type: "boolean", default: false },
} });
const release = { id: values.id, root: values.root, port: Number(values.port) };
validateRelease(release);
if (process.getuid() !== 0 || !/^[a-f0-9]{40}$/.test(values.commit ?? "")) throw Error("Host root and full source commit required");
if (await realpath(release.root) !== release.root) throw Error("Use a real release directory");
const entries = await readdir(release.root);
if (entries.includes("release-ready.json")) throw Error("Completed release artifacts must not be rebuilt");
if (entries.some((name) => name.startsWith(".env") || (name === ".next" && !values.retry))) throw Error("Use fresh source without environment files; retry is only for a failed compilation");
const configured = JSON.parse(await readFile(values.config, "utf8"));
if (Object.keys(configured).some((key) => !key.startsWith("NEXT_PUBLIC_") && !["NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", "BETTER_AUTH_URL"].includes(key))) throw Error("Build configuration must not contain runtime credentials");
if (typeof configured.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY !== "string" || configured.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY.length < 20) throw Error("Existing action encryption key required");
const env = {
  PATH: process.env.PATH, HOME: "/var/lib/fletch", ...configured,
  NEXT_DEPLOYMENT_ID: release.id, NEXT_TELEMETRY_DISABLED: "1",
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  DATABASE_URL: "postgresql://build:build@127.0.0.1:1/build",
  FORGE_BUILD_EXECUTION: "worker", NODE_OPTIONS: "--max-old-space-size=4096",
};
const exec = promisify(execFile);
async function run(args) {
  const result = await exec("/usr/sbin/runuser", ["-u", "fletch", "--", ...args], { cwd: release.root, env, timeout: 900000, maxBuffer: 16 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}
await run(["npm", "ci", "--include=dev", "--no-audit", "--no-fund"]);
await run(["nice", "-n", "10", process.execPath, "node_modules/next/dist/bin/next", "build", "--webpack"]);
await rm(`${release.root}/.next/cache/webpack`, { recursive: true, force: true });
for (const from of [".next/static", "public"]) await cp(`${release.root}/${from}`, `${release.root}/.next/standalone/${from}`, { recursive: true, force: true });
const built = JSON.parse(await readFile(`${release.root}/.next/required-server-files.json`, "utf8"));
if (built.config.deploymentId !== release.id || built.config.output !== "standalone") throw Error("Unexpected production configuration");
await access(`${release.root}/.next/standalone/server.js`);
for (const file of ["swagger-ui.css", "swagger-ui-bundle.js", "swagger-ui-standalone-preset.js"]) await access(`${release.root}/.next/standalone/node_modules/swagger-ui-dist/${file}`);
await writeFile(`${release.root}/release-ready.json`, JSON.stringify({ ...release, commit: values.commit, builtAt: new Date().toISOString(), deploymentId: built.config.deploymentId, buildHost: "build-server" }, null, 2) + "\n", { mode: 0o644, flag: "wx" });
console.log("Standalone web artifact ready for transfer. No live services were changed.");
