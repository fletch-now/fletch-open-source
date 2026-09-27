import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Discover nested suites consistently in local shells and CI.
const files = (await Promise.all(["lib", "components"].map(async (directory) =>
  (await readdir(directory, { recursive: true }))
    .filter((file) => /\.test\.tsx?$/.test(file))
    .map((file) => join(directory, file)),
))).flat().sort();
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...process.argv.slice(2), ...files], {
  stdio: "inherit", env: { ...process.env, TZ: "UTC" },
});
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
