import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const templateRoot = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(templateRoot, 'template.json'), 'utf8'));
// Emitted before Vite runs any project code, so an app cannot supply this receipt.
process.stdout.write(`FLETCH_TEMPLATE_VERSION=${manifest.version}\n`);
const result = spawnSync(join(templateRoot, 'node_modules/.bin/vite'), ['build', '--config', 'vite.config.mts'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
