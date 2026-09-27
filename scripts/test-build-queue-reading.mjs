// Render the actual reply component with controlled queue snapshots; no builder/API calls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = process.cwd();
const require = createRequire(join(root, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require(process.env.FLETCH_PLAYWRIGHT_PATH ?? 'playwright');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const directory = await mkdtemp(join(tmpdir(), 'fletch-queue-reading-'));
const artifacts = process.env.FLETCH_QUEUE_ARTIFACTS ?? '/tmp/fletch-queue-reading-acceptance';
await mkdir(artifacts, { recursive: true });
const snapshots = [
  { id: 'fifty-active', queue: { position: 1, ahead: 0, running: 50, reserved: 0, capacity: 50, memoryManaged: true }, title: 'Next in line', detail: 'when a slot becomes available.' },
  { id: 'fifty-queued', queue: { position: 51, ahead: 50, running: 50, reserved: 0, capacity: 50, memoryManaged: true }, title: 'Waiting in queue', detail: '50 builds are ahead of yours.' },
  { id: 'fifty-memory-wait', queue: { position: 1, ahead: 0, running: 42, reserved: 0, capacity: 50, memoryManaged: true }, title: 'Waiting to start', detail: 'when a slot and enough memory are available.' },
  { id: 'available', queue: { position: 1, ahead: 0, running: 0, reserved: 0, capacity: 2 }, title: 'Waiting to start', detail: 'Waiting for the worker to pick it up.' },
  { id: 'full', queue: { position: 1, ahead: 0, running: 2, reserved: 0, capacity: 2 }, title: 'Next in line', detail: 'when a slot becomes available.' },
  { id: 'ahead', queue: { position: 6, ahead: 5, running: 2, reserved: 0, capacity: 2 }, title: 'Waiting in queue', detail: '5 builds are ahead of yours.' },
  { id: 'recovery', queue: { position: 1, ahead: 0, running: 0, reserved: 2, capacity: 2 }, title: 'Waiting for capacity', detail: 'an earlier interruption is resolved.' },
  { id: 'reconnecting', queue: { position: 6, ahead: 5, running: 1, reserved: 1, capacity: 2 }, reconnecting: true, title: 'Reconnecting', detail: 'The last recorded position is shown below.' },
];
const checks = [];
const errors = [];
let server;
let browser;
try {
  const bundle = await build({ absWorkingDir: root, bundle: true, write: false, logLevel: 'silent', jsx: 'automatic', platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"development"' }, stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {useState} from 'react';import {createRoot} from 'react-dom/client';import {BuildReply} from './components/chat/build-reply.tsx';
    window.calls={cancel:0,edit:0};function Fixture(){const [props,setProps]=useState({});window.setSnapshot=setProps;return <BuildReply content="" active={true} {...props} onCancelQueue={()=>window.calls.cancel++} onEditQueuedPrompt={()=>window.calls.edit++}/>};createRoot(document.getElementById('root')).render(<Fixture/>);
  ` } });
  const css = (await postcss([tailwind({ base: root })]).process(await readFile(join(root, 'app/globals.css'), 'utf8'), { from: join(root, 'app/globals.css') })).css;
  server = createServer((req, res) => {
    if (req.url === '/client.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
    if (req.url === '/style.css') { res.setHeader('content-type', 'text/css'); res.end(css); return; }
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-paper text-ink p-4"><main id="root" class="mx-auto max-w-xl"></main><script src="/client.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.setSnapshot === 'function');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const snapshot of snapshots) {
      await page.evaluate(snapshot => window.setSnapshot(snapshot), snapshot);
      const panel = page.locator('[data-build-queue]');
      await panel.getByText(snapshot.title, { exact: true }).first().waitFor();
      assert.ok((await panel.innerText()).includes(snapshot.detail));
      assert.equal(await page.locator('[data-build-loader]').count(), 0, 'Queued work must not imply active model execution');
      assert.equal(await page.locator('details').count(), 0, 'An empty queue must not show zero recorded steps');
      assert.equal(await panel.locator('dd').nth(1).innerText(), `${snapshot.queue.running} of ${snapshot.queue.capacity} building`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= width);
      await page.screenshot({ path: join(artifacts, `${snapshot.id}-${width}.png`), caret: 'initial' });
      checks.push({ state: snapshot.id, width, copy: true, noFalseLoader: true, noOverflow: true });
    }
  }
  await page.evaluate(snapshot => window.setSnapshot(snapshot), snapshots[0]);
  const cancel = page.getByRole('button', { name: 'Cancel queue', exact: true });
  const edit = page.getByRole('button', { name: 'Edit prompt', exact: true });
  await cancel.focus();
  assert.equal(await cancel.evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
  await page.keyboard.press('Enter');
  await edit.focus();
  await page.keyboard.press('Space');
  assert.deepEqual(await page.evaluate(() => window.calls), { cancel: 1, edit: 1 });
  await page.evaluate(snapshot => window.setSnapshot({ ...snapshot, queueBusy: true }), snapshots[0]);
  await page.locator('[data-build-queue] button:disabled').first().waitFor();
  assert.equal(await cancel.isDisabled(), true);
  assert.equal(await edit.isDisabled(), true);
  assert.ok((await page.locator('[data-build-queue]').innerText()).includes('Confirming your change to the queue.'));
  const busyAnimation = await page.locator('[data-build-queue] span[class~="motion-safe:animate-spin"]').evaluate(node => getComputedStyle(node).animationName);
  assert.equal(busyAnimation, 'none');
  await page.evaluate(() => window.setSnapshot({ queue: null, toolCalls: [], status: 'The worker accepted the build.' }));
  await page.locator('[data-build-loader]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-build-queue]').count(), 0);
  assert.equal(await page.locator('[data-build-loader]').evaluate(node => getComputedStyle(node).animationName), 'none');
  checks.push({ callbacksAndKeyboardFocus: true, pendingActionsDisabled: true, reducedMotion: true, claimSnapshotWithoutToolsClearsQueue: true });
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'receipt.json'), JSON.stringify({ at: new Date().toISOString(), passed: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, artifacts }));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
