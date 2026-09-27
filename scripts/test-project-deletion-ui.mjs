// Actual component, controlled fetch outcomes, loopback only. No project API calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
const root = process.cwd();
const require = createRequire(join(root, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require(process.env.FLETCH_PLAYWRIGHT_PATH ?? 'playwright');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const artifacts = process.env.FLETCH_DELETE_ARTIFACTS ?? '/tmp/fletch-project-delete-ui';
await mkdir(artifacts, { recursive: true });
const bundle = await build({
  absWorkingDir: root, bundle: true, write: false, jsx: 'automatic', platform: 'browser', format: 'iife',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'controlled-ui-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(next\/navigation|sonner)$/ }, function resolve(args) { return { path: args.path, namespace: 'fixture' }; });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, function load(args) {
      if (args.path === 'sonner') return { contents: "export const toast={error(text){window.notices.push({kind:'error',text})},success(text){window.notices.push({kind:'success',text})}}", loader: 'js' };
      return { contents: "export function useRouter(){return {push(url){if(window.routeFailure)throw Error('Controlled navigation failure');window.routes.push(url)},refresh(){window.refreshes++}}}", loader: 'js' };
    });
  } }],
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {createRoot} from 'react-dom/client';import {DeleteProject} from './components/dashboard/delete-project.tsx';
    const root=createRoot(document.getElementById('root'));let version=0;
    window.reset=function(mode){window.notices=[];window.routes=[];window.refreshes=0;window.requests=[];window.mode=mode;window.routeFailure=false;root.render(<DeleteProject key={++version} projectId="controlled-fixture" name="A fixture app with a long project name" afterHref="/dashboard"/>)};
    window.fetch=async function(url,options){window.requests.push({url,method:options.method});if(window.mode==='network')throw Error('Controlled lost response');if(window.mode==='pending')await new Promise(resolve=>window.release=resolve);return new Response(JSON.stringify(window.mode==='server-error'?{error:'Deletion could not finish. Retry Delete.'}:{ok:true,freedBytes:1048576}),{status:window.mode==='server-error'?500:200,headers:{'content-type':'application/json'}})};
    window.reset('network');
  ` },
});
const css = (await postcss([tailwind({ base: root })]).process(await readFile(join(root, 'app/globals.css'), 'utf8'), { from: join(root, 'app/globals.css') })).css;
const server = createServer(function serve(req, res) {
  if (req.url === '/client.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  if (req.url === '/style.css') { res.setHeader('content-type', 'text/css'); res.end(css); return; }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-paper text-ink p-4"><main id="root" class="mx-auto max-w-xl"></main><script src="/client.js"></script></body></html>');
});
await new Promise(function listen(resolve) { server.listen(0, '127.0.0.1', resolve); });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const checks = [];
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', function error(cause) { errors.push(cause.message); });
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
  async function reset(mode) { await page.evaluate(mode => window.reset(mode), mode); await page.getByRole('button', { name: 'Delete', exact: true }).waitFor(); }
  async function confirm() { await page.getByRole('button', { name: 'Delete', exact: true }).click(); await page.getByRole('button', { name: 'Delete', exact: true }).click(); }
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    await reset('network');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    assert.ok((await page.locator('main').innerText()).includes('Build receipts and credit history are kept.'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(artifacts, `confirmation-${width}.png`), caret: 'initial' });
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForFunction(() => window.notices.length === 1);
    assert.ok((await page.evaluate(() => window.notices[0].text)).includes('Could not confirm deletion'));
    assert.equal(await page.getByRole('button', { name: 'Delete', exact: true }).isEnabled(), true);
    assert.deepEqual(await page.evaluate(() => window.routes), []);
    checks.push({ width, retainedAuditCopy: true, noOverflow: true, networkFailureReportedAndRetryEnabled: true });
  }
  await reset('server-error'); await confirm();
  await page.waitForFunction(() => window.notices.length === 1);
  assert.equal(await page.evaluate(() => window.notices[0].kind), 'error');
  checks.push({ serverErrorReported: true });
  await reset('pending'); await confirm();
  assert.equal(await page.getByRole('button', { name: 'Deleting…', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Keep', exact: true }).isDisabled(), true);
  await page.evaluate(() => window.release());
  await page.waitForFunction(() => window.notices.length === 1);
  assert.equal(await page.evaluate(() => window.requests.length), 1);
  assert.deepEqual(await page.evaluate(() => window.routes), ['/dashboard']);
  checks.push({ pendingButtonsDisabled: true, oneRequest: true, completedRedirect: true });
  await reset('success'); await confirm();
  await page.waitForFunction(() => window.notices.length === 1);
  assert.equal(await page.evaluate(() => window.notices[0].kind), 'success');
  checks.push({ completedRetryUsesSuccessfulResponse: true });
  await reset('success'); await page.evaluate(() => window.routeFailure = true); await confirm();
  await page.waitForFunction(() => window.notices.length >= 1);
  assert.ok((await page.evaluate(() => window.notices)).every(notice => notice.kind === 'success'));
  assert.deepEqual(errors, []);
  checks.push({ confirmedDeletionNeverReportedAsFailedByNavigation: true });
  await writeFile(join(artifacts, 'receipt.json'), JSON.stringify({ at: new Date().toISOString(), passed: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, artifacts }));
} finally {
  await browser.close();
  await new Promise(function close(resolve) { server.close(resolve); });
}
