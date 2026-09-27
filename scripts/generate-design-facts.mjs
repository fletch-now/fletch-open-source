import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const skill = new URL("../skills/fletch-design/SKILL.md", import.meta.url);
const target = new URL("../lib/agent/design-facts.ts", import.meta.url);
const source = await readFile(skill, "utf8");
const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
if (!body || Buffer.byteLength(body) > 8_000) throw new Error("Design facts must be present and remain within the 8 KB context cap.");
const output = `// Generated from skills/fletch-design/SKILL.md. Run node scripts/generate-design-facts.mjs.\nexport const DESIGN_FACTS = ${JSON.stringify(body)};\n`;
if (process.argv.includes("--check")) {
  if (await readFile(target, "utf8") !== output) throw new Error("The compiled design prompt differs from SKILL.md. Regenerate design facts.");
} else {
  await writeFile(target, output);
  console.log(`Generated ${fileURLToPath(target)} (${Buffer.byteLength(body)} bytes of prompt context).`);
}
