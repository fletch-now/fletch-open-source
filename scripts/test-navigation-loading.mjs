// Actual Next routing with delayed loopback responses; no application services or paid requests.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const require = createRequire(join(root, 'package.json'));
const { chromium } = require(process.env.FLETCH_PLAYWRIGHT_PATH ?? 'playwright');
const fixture = await mkdtemp(join(tmpdir(), 'fletch-navigation-'));
const artifacts = process.env.FLETCH_NAVIGATION_ARTIFACTS ?? join(fixture, 'artifacts');
await mkdir(artifacts, { recursive: true });
const held = new Map();
const released = new Set();
const control = createServer((req, res) => {
  const key = new URL(req.url, 'http://fixture').searchParams.get('case');
  if (released.has(key)) { res.end('released'); return; }
  const responses = held.get(key) ?? [];
  responses.push(res);
  held.set(key, responses);
});
await new Promise(resolve => control.listen(0, '127.0.0.1', resolve));
const controlOrigin = `http://127.0.0.1:${control.address().port}`;
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const checks = [];
let child;
let browser;
let serverLog = '';
function release(key) {
  const response = held.get(key);
  assert.ok(response, `fixture request ${key} did not reach the server`);
  released.add(key);
  for (const pending of response) pending.end('released');
  held.delete(key);
}
async function waitFor(check, message, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() > end) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
try {
  await symlink(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
  await mkdir(join(fixture, 'components/ui'), { recursive: true });
  for (const file of ['navigation-link.tsx', 'navigation-loading.tsx']) await cp(join(root, 'components/ui', file), join(fixture, 'components/ui', file));
  await mkdir(join(fixture, 'app/slow'), { recursive: true });
  await mkdir(join(fixture, 'app/fast'), { recursive: true });
  await writeFile(join(fixture, 'package.json'), JSON.stringify({ private: true, scripts: {}, dependencies: { next: '16.3.3', react: '19.2.8', 'react-dom': '19.2.8' } }));
  await writeFile(join(fixture, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2020', lib: ['dom', 'esnext'], jsx: 'react-jsx', module: 'esnext', moduleResolution: 'bundler', esModuleInterop: true, allowJs: true, skipLibCheck: true, strict: true }, include: ['**/*.ts', '**/*.tsx'] }));
  await cp(join(root, 'postcss.config.mjs'), join(fixture, 'postcss.config.mjs'));
  await cp(join(root, 'app/globals.css'), join(fixture, 'app/globals.css'));
  await writeFile(join(fixture, 'next.config.mjs'), 'export default { devIndicators:false };');
  await writeFile(join(fixture, 'app/layout.tsx'), `import './globals.css';export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body className="bg-paper text-ink p-6">{children}</body></html>}`);
  await writeFile(join(fixture, 'app/page.tsx'), `"use client";
    import {useEffect,useRef} from 'react';import Link from '../components/ui/navigation-link';
    export default function Page(){const link=useRef<HTMLAnchorElement>(null);useEffect(()=>{document.body.dataset.refTag=link.current?.tagName},[]);
      return <main><h1>Current page remains visible</h1><nav className="mt-6 flex flex-wrap gap-5">
        <Link ref={link} id="slow" href="/slow?case=slow" prefetch={false} scroll={false} title="Delayed page" onClick={()=>document.body.dataset.clicked='yes'}>Status</Link>
        <Link id="other" href="/slow?case=other" prefetch={false}>Other slow tab</Link>
        <Link id="fast" href="/fast" prefetch={false}>Fast tab</Link>
        <Link id="failure" href="/slow?case=failure" prefetch={false}>Failed page</Link>
        <Link id="cancelled" href="/slow?case=cancelled" prefetch={false} onNavigate={event=>event.preventDefault()}>Cancelled navigation</Link>
        <Link id="hash" href="#target">Section</Link>
        <Link id="external" href="https://example.invalid" target="_blank">External</Link>
        <Link id="new-tab" href="/fast" target="_blank">New tab</Link>
        <Link id="download" href="/fixture.txt" download>Download</Link>
      </nav><p id="target" className="mt-12">Existing reading stays available.</p></main>}`);
  await writeFile(join(fixture, 'app/slow/page.tsx'), `import Link from '../../components/ui/navigation-link';export default async function Slow({searchParams}:{searchParams:Promise<{case?:string}>}){const key=(await searchParams).case??'slow';await fetch(${JSON.stringify(controlOrigin)}+'/gate?case='+key,{cache:'no-store'});if(key==='failure')throw new Error('Controlled route failure');return <main><h1>Finished reading</h1><Link href="/">Home</Link></main>}`);
  await writeFile(join(fixture, 'app/fast/page.tsx'), 'export default function Fast(){return <h1>Fast destination</h1>}');
  await writeFile(join(fixture, 'app/error.tsx'), '"use client";export default function ErrorPage(){return <h1>Page could not load</h1>}');
  await mkdir(join(fixture, 'public'));
  await writeFile(join(fixture, 'public/fixture.txt'), 'fixture download');
  child = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: fixture, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { serverLog += String(data); });
  await waitFor(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, 'Isolated Next fixture did not start');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ acceptDownloads: true });
  await context.route('https://example.invalid/**', route => route.fulfill({ status: 200, body: 'External fixture' }));
  const page = await context.newPage();
  const loader = page.locator('[data-navigation-loading]');
  for (const width of [320, 390, 1280]) {
    released.delete('slow');
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('#slow').click();
    await loader.waitFor({ state: 'visible' });
    assert.equal(await page.locator('h1').innerText(), 'Current page remains visible');
    assert.equal(await page.locator('body').getAttribute('data-clicked'), 'yes');
    assert.equal(await page.locator('body').getAttribute('data-ref-tag'), 'A');
    assert.equal(await page.locator('#slow').getAttribute('title'), 'Delayed page');
    assert.equal(await loader.getAttribute('role'), 'status');
    assert.equal(await loader.getAttribute('aria-valuenow'), null);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= width);
    await page.screenshot({ path: join(artifacts, `pending-${width}.png`), caret: 'initial' });
    await waitFor(() => held.has('slow'), 'Slow route never started');
    release('slow');
    await page.getByRole('heading', { name: 'Finished reading' }).waitFor();
    await loader.waitFor({ state: 'detached' });
    checks.push({ width, immediatePending: true, previousContentRetained: true, propsAndRef: true, cleared: true });
  }
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('#other').click();
  await loader.waitFor({ state: 'visible' });
  await waitFor(() => held.has('other'), 'Interrupted request never started');
  await page.locator('#fast').click();
  await page.getByRole('heading', { name: 'Fast destination' }).waitFor();
  await loader.waitFor({ state: 'detached' });
  release('other');
  checks.push({ supersededNavigationClears: true });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('#failure').click();
  await loader.waitFor({ state: 'visible' });
  await waitFor(() => held.has('failure'), 'Failed request never started');
  release('failure');
  await page.getByRole('heading', { name: 'Page could not load' }).waitFor();
  await loader.waitFor({ state: 'detached' });
  checks.push({ failedNavigationClears: true });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('#cancelled').click();
  await page.waitForTimeout(100);
  assert.equal(await loader.count(), 0);
  assert.equal(held.has('cancelled'), false);
  await page.locator('#hash').click();
  await page.waitForTimeout(100);
  assert.equal(await loader.count(), 0);
  for (const selector of ['#external', '#new-tab']) {
    const popup = context.waitForEvent('page');
    await page.locator(selector).click();
    const opened = await popup;
    await opened.close();
    assert.equal(await loader.count(), 0);
  }
  const download = page.waitForEvent('download');
  await page.locator('#download').click();
  await download;
  assert.equal(await loader.count(), 0);
  const modified = context.waitForEvent('page');
  await page.locator('#fast').click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await (await modified).close();
  assert.equal(await loader.count(), 0);
  assert.equal((await context.request.get(origin + '/not-a-page')).status(), 404);
  checks.push({ cancelledHashExternalModifiedNewTabDownloadExcluded: true, notFoundStatus: 404 });
  released.delete('slow');
  const reduced = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 900 } });
  const quiet = await reduced.newPage();
  await quiet.goto(origin, { waitUntil: 'networkidle' });
  await quiet.locator('#slow').click();
  await quiet.locator('[data-navigation-loading]').waitFor({ state: 'visible' });
  const animations = await quiet.locator('[data-navigation-loading] [aria-hidden]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationName));
  assert.ok(animations.every(name => name === 'none'), JSON.stringify(animations));
  await waitFor(() => held.has('slow'), 'Reduced-motion navigation never started');
  release('slow');
  await quiet.getByRole('heading', { name: 'Finished reading' }).waitFor();
  await quiet.locator('[data-navigation-loading]').waitFor({ state: 'detached' });
  checks.push({ reducedMotion: true, animationNames: animations });
  await writeFile(join(artifacts, 'receipt.json'), JSON.stringify({ at: new Date().toISOString(), passed: true, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, artifacts }));
} finally {
  await browser?.close();
  for (const responses of held.values()) for (const response of responses) response.end('fixture ended');
  control.closeAllConnections();
  await new Promise(resolve => control.close(resolve));
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await writeFile(join(artifacts, 'server.log'), serverLog);
  // Screenshots and receipts can live outside the disposable app.
  if (!artifacts.startsWith(fixture + '/')) await rm(fixture, { recursive: true, force: true });
}
