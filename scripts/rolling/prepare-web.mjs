import { execFile } from "node:child_process";
import { access, cp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { parseArgs, parseEnv, promisify } from "node:util";
import { validateRelease } from "./web-config.mjs";

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    root: { type: "string" },
    port: { type: "string" },
    commit: { type: "string" },
  },
});
const release = { id: values.id, root: values.root, port: Number(values.port) };
validateRelease(release);
if (await realpath(release.root) !== release.root) throw new Error("Candidate path must not contain symlinks");
if (process.getuid() !== 0 || !/^[a-f0-9]{40}$/.test(values.commit ?? ""))
  throw new Error("Host root and full source commit are required");
const memory = await readFile("/proc/meminfo", "utf8");
const availableKiB = Number(memory.match(/^MemAvailable:\s+(\d+)/m)?.[1] ?? 0);
if (availableKiB < 8 * 1024 * 1024)
  throw new Error("Less than 8 GiB available. Compile on the build server and transfer the standalone artifact.");
const existing = await readFile(
  "/var/lib/fletch/web-rollouts/current.json",
  "utf8",
)
  .then(JSON.parse)
  .catch(function absent(error) {
    if (error.code === "ENOENT") return null;
    throw error;
  });
const previousRoot = existing?.release.root ?? "/opt/fletch/app";
const retainedRoots = [
  previousRoot,
  "/opt/fletch/app",
  ...(existing?.retained ?? []).map((entry) => entry.root),
];
if (retainedRoots.includes(release.root))
  throw new Error("Use a fresh candidate directory");
const entries = await readdir(release.root);
if (entries.some((name) => name.startsWith(".env") || name === ".next"))
  throw new Error("Candidate must have no environment files or existing build");
await access(`${release.root}/package-lock.json`);
const configured = parseEnv(
  await readFile("/etc/fletch/fletch.env", "utf8"),
);
if (configured.FORGE_BUILD_EXECUTION !== "worker")
  throw new Error("Independent build execution is required");
const actions = JSON.parse(
  await readFile(
    `${previousRoot}/.next/server/server-reference-manifest.json`,
    "utf8",
  ),
);
if (
  typeof actions.encryptionKey !== "string" ||
  actions.encryptionKey.length < 20
)
  throw new Error("Existing Server Action key is missing");
const env = {
  ...process.env,
  ...configured,
  NEXT_DEPLOYMENT_ID: release.id,
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: actions.encryptionKey,
};
const exec = promisify(execFile);
async function run(args) {
  const result = await exec(
    "/usr/sbin/runuser",
    ["-u", "fletch", "--", ...args],
    {
      cwd: release.root,
      env,
      timeout: 900000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}
await run(["npm", "ci", "--include=dev", "--no-audit", "--no-fund"]);
await run([
  "nice",
  "-n",
  "10",
  "/usr/bin/node",
  "node_modules/next/dist/bin/next",
  "build",
  "--webpack",
]);
// Immutable releases are never rebuilt in place. Runtime assets and data/image
// caches remain; webpack's build cache would only consume hosting capacity.
await rm(`${release.root}/.next/cache/webpack`, { recursive: true, force: true });
for (const [from, to] of [
  [".next/static", ".next/standalone/.next/static"],
  ["public", ".next/standalone/public"],
]) {
  await cp(`${release.root}/${from}`, `${release.root}/${to}`, {
    recursive: true,
    // Next may already trace fonts into standalone/public. Complete the asset
    // tree from this same fresh candidate; neither path is an active release.
    force: true,
  });
}
const built = JSON.parse(
  await readFile(`${release.root}/.next/required-server-files.json`, "utf8"),
);
if (
  built.config.deploymentId !== release.id ||
  built.config.output !== "standalone"
)
  throw new Error("Unexpected production build configuration");
await access(`${release.root}/.next/standalone/server.js`);
// These browser assets are read dynamically, so require their traced copies.
for (const file of ["swagger-ui.css", "swagger-ui-bundle.js", "swagger-ui-standalone-preset.js"]) {
  await access(`${release.root}/.next/standalone/node_modules/swagger-ui-dist/${file}`);
}
await writeFile(
  `${release.root}/release-ready.json`,
  JSON.stringify(
    {
      ...release,
      commit: values.commit,
      builtAt: new Date().toISOString(),
      deploymentId: built.config.deploymentId,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o644, flag: "wx" },
);
console.log("Immutable web candidate built. Live services were retained.");
