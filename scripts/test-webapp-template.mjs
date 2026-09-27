import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const image = process.env.FLETCH_TEMPLATE_TEST_IMAGE ?? 'fletch-agent:wallet-v2.0.2-local';
const workspace = await mkdtemp(join(tmpdir(), 'fletch-design-sandbox-'));
const template = resolve('docker/webapp-template');
function sandbox(command, expectedStatus = 0) {
  const args = ['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`, '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only', '--network=none', '--memory=2g', '--cpus=1.5', '--pids-limit=256', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '-v', `${workspace}:/work`, '-w', '/work', '-e', 'HOME=/work/.agent-home', image, ...command];
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, expectedStatus, result.stderr + result.stdout);
  return result.stdout;
}
try {
  sandbox(['node', '-e', 'const fs=require("fs"); if(!fs.existsSync("/work/fletch/tokens.css")) process.exit(1)']);
  const originalCss = await readFile(join(workspace, 'fletch/tokens.css'), 'utf8');
  await writeFile(join(workspace, 'fletch/tokens.css'), originalCss + '\n/* preserved project edit */\n');
  sandbox(['true']);
  assert.ok((await readFile(join(workspace, 'fletch/tokens.css'), 'utf8')).endsWith('/* preserved project edit */\n'));
  await mkdir(join(workspace, 'src'));
  await cp(join(template, 'example/index.html'), join(workspace, 'index.html'));
  await cp(join(template, 'example/main.tsx'), join(workspace, 'src/main.tsx'));
  await cp(join(template, 'example/app.css'), join(workspace, 'src/app.css'));
  await mkdir(join(workspace, 'public'));
  await cp(join(template, 'example/favicon.svg'), join(workspace, 'public/favicon.svg'));
  await writeFile(join(workspace, 'vite.config.mts'), 'import { defineConfig } from "vite"; import react from "@vitejs/plugin-react"; export default defineConfig({plugins:[react()],base:"./",build:{target:"es2020"}});');
  await writeFile(join(workspace, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2020', lib: ['DOM', 'ES2020'], module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true }, include: ['src', 'fletch'] }));
  sandbox(['ln', '-s', '/opt/webapp/node_modules', '/work/node_modules']);
  sandbox(['/opt/webapp/node_modules/.bin/tsc', '--noEmit']);
  await writeFile(join(workspace, 'src/ambiguous-clock.ts'), 'import {useBlockNumber} from "../fletch/reads"; useBlockNumber();');
  const ambiguousImport = sandbox(['/opt/webapp/node_modules/.bin/tsc', '--noEmit'], 2);
  assert.match(ambiguousImport, /has no exported member ['"]useBlockNumber['"]/);
  await rm(join(workspace, 'src/ambiguous-clock.ts'));
  const readBuild = sandbox(['node', '/opt/webapp/build.mjs']);
  assert.match(readBuild, /^FLETCH_TEMPLATE_VERSION=2\.0\.2/m);
  assert.ok((await readFile(join(workspace, 'dist/index.html'), 'utf8')).includes('Chain Field Notes'));
  await cp(join(workspace, 'dist'), join(workspace, 'read-dist'), { recursive: true });
  // Compile the signing foundation too, including injected wallets without a WalletConnect project ID.
  await writeFile(join(workspace, 'src/main.tsx'), 'import {createRoot} from "react-dom/client"; import {WalletProvider,WalletControl} from "../fletch/wallet"; import "../fletch/tokens.css"; createRoot(document.getElementById("root")!).render(<WalletProvider><WalletControl/></WalletProvider>);');
  sandbox(['/opt/webapp/node_modules/.bin/tsc', '--noEmit']);
  const walletBuild = sandbox(['node', '/opt/webapp/build.mjs']);
  assert.match(walletBuild, /^FLETCH_TEMPLATE_VERSION=2\.0\.2/m);
  console.log(JSON.stringify({ image, workspace, passed: ['locked-down entrypoint seeds foundation', 'repeat entrypoint preserves edits', 'strict template types', 'ambiguous block hook import rejected', 'read-only example Vite build', 'wallet Vite build', 'actual image template version receipt'], walletPairing: 'not exercised; no project ID or wallet supplied', network: 'none' }));
} finally {
  if (process.env.FLETCH_KEEP_TEMPLATE_TEST !== '1') await rm(workspace, { recursive: true, force: true });
}
