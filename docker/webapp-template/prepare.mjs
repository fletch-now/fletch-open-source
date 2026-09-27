import { cp, lstat, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const templateRoot = dirname(fileURLToPath(import.meta.url));
const workspace = process.argv[2] ?? '/work';
const destination = join(workspace, 'fletch');
const existing = await lstat(destination).catch(function missing(error) {
  if (error.code === 'ENOENT') return null;
  throw error;
});
// The directory is editable project source. An image upgrade must not replace it.
if (!existing) {
  await cp(join(templateRoot, 'foundation'), destination, { recursive: true, force: false, errorOnExist: true });
  await cp(join(templateRoot, 'template.json'), join(destination, 'template.json'), { force: false, errorOnExist: true });
}
const manifest = JSON.parse(await readFile(join(templateRoot, 'template.json'), 'utf8'));
if (!manifest.version) throw new Error('The sandbox template is missing its version.');
