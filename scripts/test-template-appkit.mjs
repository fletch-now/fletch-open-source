// Real installed AppKit/Wagmi adapter; controlled EIP-1193 providers, no signing.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const template = join(root, 'docker/webapp-template');
const require = createRequire(join(root, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require(process.env.FLETCH_PLAYWRIGHT_PATH ?? 'playwright');
const directory = await mkdtemp(join(tmpdir(), 'fletch-template-appkit-'));
const cases = [
  { mode: 'legacy', wallet: 'Phantom', withId: true },
  { mode: 'announced', wallet: 'Phantom', withId: true },
  { mode: 'announced', wallet: 'MetaMask', withId: true },
  { mode: 'announced', wallet: 'Phantom', withId: false },
];
const results = [];
let server;
let browser;

function installProviders({ mode }) {
  window.walletRequests = [];
  function provider(name) {
    let connected = false;
    const address = '0x0000000000000000000000000000000000000001';
    const handlers = new Map();
    return {
      isPhantom: name === 'Phantom', isMetaMask: name === 'MetaMask',
      on(event, listener) {
        const listeners = handlers.get(event) ?? [];
        listeners.push(listener);
        handlers.set(event, listeners);
      },
      removeListener(event, listener) {
        handlers.set(event, (handlers.get(event) ?? []).filter(function keep(value) { return value !== listener; }));
      },
      async request({ method }) {
        window.walletRequests.push({ wallet: name, method });
        if (/sign|sendTransaction/i.test(method)) throw new Error('Signing is forbidden in this fixture.');
        if (method === 'eth_chainId') return '0xb626';
        if (method === 'eth_accounts') return connected ? [address] : [];
        if (method === 'wallet_requestPermissions') {
          connected = true;
          return [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [address] }] }];
        }
        if (method === 'eth_requestAccounts') { connected = true; return [address]; }
        if (method === 'wallet_revokePermissions') { connected = false; return null; }
        throw new Error(`Unexpected controlled provider method: ${method}`);
      },
    };
  }
  const phantom = provider('Phantom');
  const metamask = provider('MetaMask');
  window.phantom = { ethereum: phantom };
  window.ethereum = metamask;
  function announce() {
    const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    for (const [name, source, uuid, rdns] of [
      ['Phantom', phantom, '9a6d6f10-98cd-4bd4-9ea2-abaaf1111111', 'app.phantom'],
      ['MetaMask', metamask, '9a6d6f10-98cd-4bd4-9ea2-abaaf2222222', 'io.metamask'],
    ]) {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { info: { name, uuid, rdns, icon }, provider: source },
      }));
    }
  }
  if (mode === 'announced') window.addEventListener('eip6963:requestProvider', announce);
}

async function verifyWallet(origin, example) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 850 }, serviceWorkers: 'block' });
  const blockedRequests = [];
  const pageErrors = [];
  try {
    await context.route('**/*', function routeRequest(route) {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      blockedRequests.push({ transport: 'http', host: url.hostname, path: url.pathname });
      return route.abort();
    });
    await context.routeWebSocket('**/*', function blockSocket(socket) {
      blockedRequests.push({ transport: 'websocket', host: new URL(socket.url()).hostname });
      socket.close();
    });
    await context.addInitScript(installProviders, example);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(15_000);
    page.on('pageerror', function record(error) { pageErrors.push(error.message); });
    await page.goto(example.withId ? origin : `${origin}/?no-id`);
    const connect = page.getByRole('button', { name: 'Connect wallet', exact: true });
    await connect.focus();
    await connect.press('Enter');
    if (!example.withId) await page.getByRole('group', { name: 'Detected browser wallets' }).waitFor();
    const phantom = page.getByText('Phantom', { exact: true });
    await phantom.waitFor();
    assert.equal(await phantom.count(), 1, 'Phantom legacy and announced providers should produce one option');
    if (example.mode === 'announced') await page.getByText('MetaMask', { exact: true }).waitFor();
    // Both the local chooser and AppKit shadow-root options expose keyboard buttons.
    const walletButton = page.getByRole('button', { name: new RegExp(`^${example.wallet}\\b`, 'i') });
    await walletButton.focus();
    await walletButton.press('Enter');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
    await page.waitForFunction(function ready() { return !document.querySelector('[data-sign]').disabled; });
    const walletRequests = await page.evaluate(function requests() { return window.walletRequests; });
    assert.ok(walletRequests.some(function requested(row) {
      return row.wallet === example.wallet && ['eth_requestAccounts', 'wallet_requestPermissions'].includes(row.method);
    }), 'Connection must reach the selected injected provider');
    assert.equal(walletRequests.some(function signed(row) { return /sign|sendTransaction/i.test(row.method); }), false);
    assert.deepEqual(pageErrors, []);
    return { ...example, connected: true, keyboardSelection: true, walletRequests, blockedRequests, pageErrors };
  } finally {
    await context.close();
  }
}

try {
  for (const withId of [true, false]) {
    await build({
      stdin: { resolveDir: template, loader: 'tsx', contents: `
        import {createRoot} from 'react-dom/client';
        import {WalletProvider,WalletControl,useWalletReady} from './foundation/wallet';
        function App(){const ready=useWalletReady();return <><WalletControl/><button data-sign disabled={!ready.ready}>Signing action</button></>}
        createRoot(document.getElementById('root')).render(<WalletProvider><App/></WalletProvider>);
      ` },
      outfile: join(directory, withId ? 'app.js' : 'without-id.js'), bundle: true, format: 'iife', platform: 'browser',
      target: 'es2020', jsx: 'automatic', logLevel: 'silent',
      define: {
        'process.env.NODE_ENV': '"production"',
        // A synthetic public ID selects the real configured-ID branch. Remote project authorization is not tested.
        'import.meta.env': JSON.stringify({ VITE_CHAIN_ID: '46630', VITE_RPC_URL: 'https://rpc.fixture.invalid', VITE_WALLETCONNECT_PROJECT_ID: withId ? '0123456789abcdef0123456789abcdef' : '' }),
      },
    });
  }
  server = createServer(async function serve(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (['/app.js', '/without-id.js'].includes(url.pathname)) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(join(directory, url.pathname.slice(1))));
      return;
    }
    if (url.pathname !== '/') { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'text/html');
    const bundle = url.searchParams.has('no-id') ? 'without-id.js' : 'app.js';
    response.end(`<html><head><title>Shared foundation AppKit fixture</title></head><body><div id="root"></div><script src="/${bundle}"></script></body></html>`);
  });
  await new Promise(function listen(resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true, timeout: 20_000,
    executablePath: process.env.FLETCH_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  for (const example of cases) results.push(await verifyWallet(origin, example));
  console.log(JSON.stringify({
    actualSdkImports: true, mockedAdapterOrModal: false, configuredIdCases: 3, emptyIdCases: 1, syntheticProjectId: true,
    realProjectAuthorization: false, realPairing: false, signingRequests: 0,
    externalRequestsAllowed: 0,
    blockedSdkRequests: results.reduce(function total(sum, row) { return sum + row.blockedRequests.length; }, 0),
    results,
  }));
} finally {
  await browser?.close();
  if (server) await new Promise(function close(resolve) { server.close(resolve); });
  await rm(directory, { recursive: true, force: true });
}
