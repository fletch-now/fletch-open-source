import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { prepareShareMetadata } from "./share-metadata";
import { appMetadata } from "../apps/generated-metadata";

test("share metadata freezes real app descriptions, escapes input and preserves app scripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "fletch-share-"));
  try {
    const dist = join(root, "dist"); await mkdir(dist);
    const source = '<html><head><title>Vault</title><meta name="description" content="Vault shares"><meta name="viewport" content="width=device-width"></head><body><div id="root"></div><script src="./assets/app.js"></script></body></html>';
    await writeFile(join(dist, "index.html"), source);
    await writeFile(join(root, "index.html"), source);
    await writeFile(join(root, "fletch.project.json"), JSON.stringify({ name: 'Vault "$&"', summary: 'Deposit & withdraw shares. Testnet only.', description: 'The owner selects the deposit token. Connected wallets can deposit and withdraw.' }));
    await prepareShareMetadata(dist, root, "fixture-vault", "Vault");
    await prepareShareMetadata(dist, root, "fixture-vault", "Vault");
    const html = await readFile(join(dist, "index.html"), "utf8");
    assert.ok(html.includes('<script src="./assets/app.js"></script>'));
    assert.ok(html.includes('Vault &quot;$&amp;&quot;'));
    assert.equal((html.match(/name="description"/g) ?? []).length, 1);
    assert.equal((html.match(/property="og:image"/g) ?? []).length, 1);
    assert.ok(html.includes('data-fletch-build-link'));
    assert.equal((html.match(/data-fletch-share/g) ?? []).length, 1);
    const image = await sharp(join(dist, "fletch-share.png")).metadata();
    assert.equal(image.width, 1200); assert.equal(image.height, 630);
    assert.match(await readFile(join(dist, "robots.txt"), "utf8"), /sitemap.xml/);
    assert.ok((await readFile(join(dist, "sitemap.xml"), "utf8")).includes('fixture-vault'));
    assert.equal(JSON.parse(await readFile(join(dist, "fletch-share.json"), "utf8")).description, 'The owner selects the deposit token. Connected wallets can deposit and withdraw.');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("listing suggestions use completed metadata and honest HTML fallbacks without prompt text", () => {
  assert.deepEqual(appMetadata('{"name":"Counter","summary":"Track clicks","description":"A browser counter."}', null, "Untitled"), { title: "Counter", summary: "Track clicks", description: "A browser counter." });
  assert.equal(appMetadata('invalid', '<title>Old app</title><meta content="An old app" name="description">', 'Untitled').summary, "An old app");
  assert.equal(appMetadata('{"name":"<script>x</script>"}', null, 'Untitled').title.includes('<'), false);
});
