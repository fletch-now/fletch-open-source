import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const filename = resolve(".env.local");
let text = await readFile(".env.example", "utf8");
for (const key of ["BETTER_AUTH_SECRET", "MODEL_CREDENTIAL_KEY"]) {
  text = text.replace(new RegExp(`^${key}=$`, "m"), `${key}=${randomBytes(32).toString("hex")}`);
}
for (const [key, directory] of [["FORGE_WORKSPACE_ROOT", ".local/workspaces"], ["FORGE_CHECKPOINT_ROOT", ".local/checkpoints"], ["FORGE_SITES_ROOT", ".local/sites"]]) {
  const absolute = resolve(directory);
  await mkdir(absolute, { recursive: true });
  text = text.replace(new RegExp(`^${key}=$`, "m"), `${key}=${JSON.stringify(absolute)}`);
}
try {
  await writeFile(filename, text, { flag: "wx", mode: 0o600 });
  console.log("Created .env.local with new local secrets and private storage paths. Add your own model connection before running real builds.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log(".env.local already exists; it was preserved.");
}
