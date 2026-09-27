// Run on the hosting server. Copy this private file to the build server for
// compile-web.mjs, then remove both copies after the release is complete.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { validateRelease } from "./web-config.mjs";

const { values } = parseArgs({ options: { output: { type: "string" } } });
if (process.getuid() !== 0 || !values.output || !resolve(values.output).startsWith("/root/")) throw Error("Host root and an output path under /root are required");
const current = JSON.parse(await readFile("/var/lib/fletch/web-rollouts/current.json", "utf8"));
validateRelease(current.release);
const env = parseEnv(await readFile("/etc/fletch/fletch.env", "utf8"));
const configured = Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("NEXT_PUBLIC_") || key === "BETTER_AUTH_URL"));
const actions = JSON.parse(await readFile(`${current.release.root}/.next/server/server-reference-manifest.json`, "utf8"));
if (typeof actions.encryptionKey !== "string" || actions.encryptionKey.length < 20) throw Error("The current release's action key is missing");
configured.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = actions.encryptionKey;
await writeFile(values.output, JSON.stringify(configured) + "\n", { mode: 0o600, flag: "wx" });
console.log("Private web compilation configuration written.");
