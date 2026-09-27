import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
if (!files.length) throw new Error("Stage the release files before checking the export.");
const issues = [];
const forbidden = /(^|\/)(\.env(?:\.[^/]+)?|\.codex|\.claude|\.ssh|\.mcp\.json|\.npmrc|\.netrc|credentials[^/]*\.json|connection\.json|node_modules|\.next|marketing|private|backups|workspaces|checkpoints|\.local)(\/|$)|\.(?:env|pem|key|p12|pfx|dump|sqlite3?|db|har|log|jsonl|tsbuildinfo|zip|tar|gz)$/i;
for (const file of files) {
  if (forbidden.test(file) && !/(^|\/)\.env\.example$/.test(file)) issues.push(`${file}: private/generated file type`);
  if (/^docs\/(?:research|releases|archive)\//.test(file)) issues.push(`${file}: internal evidence`);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) { issues.push(`${file}: review symlinks before publication`); continue; }
  if (stat.size > 25 * 1024 * 1024) issues.push(`${file}: large asset needs separate review`);
  const bytes = readFileSync(file);
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = bytes.readUInt32BE(offset);
      const kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (["caBX", "eXIf", "tEXt", "iTXt", "zTXt"].includes(kind)) issues.push(`${file}: image metadata must be reviewed and removed`);
      offset += size + 12;
    }
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset] !== 255 || [218, 217].includes(bytes[offset + 1])) break;
      if ([225, 235, 237, 254].includes(bytes[offset + 1])) issues.push(`${file}: JPEG metadata must be reviewed and removed`);
      const size = bytes.readUInt16BE(offset + 2);
      if (size < 2) break;
      offset += size + 2;
    }
  }
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  const personal = /\/(?:Users|home)\/[a-zA-Z][\w.-]+\//;
  const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
  const authenticatedUrl = /https?:\/\/[^\s/@]+:[^\s/@]+@/;
  if (personal.test(text)) issues.push(`${file}: personal absolute path`);
  if (privateKey.test(text)) issues.push(`${file}: embedded private key`);
  if (/FORGE_EXECUTOR_HOST_ID\s*=\s*[a-f0-9]{64}/i.test(text)) issues.push(`${file}: configured machine identity`);
  if (/machine-id[^\n]{0,160}["'= ][a-f0-9]{32}["' ;\]]/i.test(text)) issues.push(`${file}: hardcoded machine identity`);
  if (/ssh-(?:rsa|ed25519)\s+[A-Za-z0-9+/]{30}/.test(text)) issues.push(`${file}: embedded SSH identity`);
  // A webhook SSRF test deliberately includes a fake authenticated URL.
  if (authenticatedUrl.test(text) && !file.endsWith(".test.ts")) issues.push(`${file}: URL with embedded credentials`);
}
if (issues.length) { console.error(issues.join("\n")); process.exitCode = 1; }
else console.log(`Public-file checks passed for ${files.length} staged/tracked files. Run Gitleaks as the separate credential check.`);
