// Actual foundation + wagmi/EIP-6963, controlled EIP-1193 providers. No signing/network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = process.cwd();
const require = createRequire(join(root, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require(process.env.FLETCH_PLAYWRIGHT_PATH ?? 'playwright');
const template = resolve('docker/webapp-template');
const directory = await mkdtemp(join(tmpdir(), 'fletch-template-wallets-'));
const reownFixture = {
  name: 'controlled-reown-modal',
  setup(builder) {
    builder.onResolve({ filter: /^@reown\/appkit(?:\/react|-adapter-wagmi)$/ }, (args) => ({ path: args.path, namespace: 'reown-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'reown-fixture' }, () => ({ resolveDir: template, loader: 'js', contents: `
      import {createConfig,http} from 'wagmi';
      export class WagmiAdapter {constructor(options){window.adapterOptions=options;this.wagmiConfig=createConfig({chains:options.networks,connectors:options.connectors,multiInjectedProviderDiscovery:options.multiInjectedProviderDiscovery,transports:options.transports});}}
      export function createAppKit(options){window.modalOptions=options;return{async open(args){window.modalOpened=args;}};}
    ` }));
  },
};
let server;
let browser;
const externalRequests = [];
try {
  for (const withId of [false, true]) {
    await build({ stdin: { resolveDir: template, loader: 'tsx', contents: `
      import {createRoot} from 'react-dom/client';
      import {WalletProvider,WalletControl,useWalletReady} from './foundation/wallet';
      function App(){const ready=useWalletReady();return <><WalletControl/><button data-sign disabled={!ready.ready}>Signing action</button><p data-ready>{ready.reason??'Ready'}</p></>}
      createRoot(document.getElementById('root')!).render(<WalletProvider><App/></WalletProvider>);
    ` }, outfile: join(directory, withId ? 'with-id.js' : 'without-id.js'), bundle: true, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic', plugins: [reownFixture], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({ VITE_CHAIN_ID: '46630', VITE_WALLETCONNECT_PROJECT_ID: withId ? 'controlled-modal-project-id' : '' }) }, logLevel: 'silent' });
  }
  server = createServer(async function serve(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/embedded') return res.end('<iframe title="App preview" src="/"></iframe>');
    if (['/with-id.js', '/without-id.js', '/with-id.css', '/without-id.css'].includes(url.pathname)) { res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(await readFile(join(directory, url.pathname.slice(1)))); }
    res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Controlled wallet fixture</title><link rel="stylesheet" href="/${url.searchParams.has('project-id') ? 'with-id' : 'without-id'}.css"></head><body><div id="root"></div><script src="/${url.searchParams.has('project-id') ? 'with-id' : 'without-id'}.js"></script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.FLETCH_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  async function fixture(mode) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      if (route.request().url().startsWith(origin)) return route.continue();
      externalRequests.push(route.request().url());
      return route.abort();
    });
    await page.addInitScript(({ mode }) => {
      window.walletRequests = [];
      function provider(name) {
        let chain = '0x1'; let connected = false;
        const handlers = new Map();
        return { isPhantom: name === 'Phantom', isMetaMask: name === 'MetaMask',
          on(event, listener) { const list = handlers.get(event) ?? []; list.push(listener); handlers.set(event, list); },
          removeListener(event, listener) { handlers.set(event, (handlers.get(event) ?? []).filter((item) => item !== listener)); },
          async request({ method, params }) {
            window.walletRequests.push({ name, method });
            const address = '0x0000000000000000000000000000000000000001';
            if (method === 'eth_chainId') return chain;
            if (method === 'eth_accounts') return connected ? [address] : [];
            if (method === 'wallet_requestPermissions') { connected = true; return [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [address] }] }]; }
            if (method === 'eth_requestAccounts') { connected = true; return [address]; }
            if (method === 'wallet_revokePermissions') { connected = false; return null; }
            if (method === 'wallet_switchEthereumChain') {
              if (window.rejectSwitch) throw Object.assign(new Error('This wallet cannot switch to Robinhood Chain Testnet.'), { code: 4902 });
              chain = params[0].chainId;
              for (const listener of handlers.get('chainChanged') ?? []) listener(chain);
              return null;
            }
            if (method === 'wallet_addEthereumChain') throw Object.assign(new Error('This wallet cannot add Robinhood Chain Testnet.'), { code: 4902 });
            throw new Error('Unexpected provider method: ' + method);
          },
        };
      }
      const phantom = provider('Phantom'); const metamask = provider('MetaMask');
      if (mode === 'legacy') window.phantom = { ethereum: phantom };
      if (mode === 'late') window.phantom = { solana: { isPhantom: true, connect() { throw new Error('Solana provider must not be used'); } } };
      function announce(name, source, uuid, rdns) { window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { name, uuid, rdns, icon: 'data:image/png;base64,iVBORw0KGgo=' }, provider: source } })); }
      window.announceWallets = function () {
        announce('Phantom', phantom, '9a6d6f10-98cd-4bd4-9ea2-abaaf1111111', 'app.phantom');
        announce('MetaMask', metamask, '9a6d6f10-98cd-4bd4-9ea2-abaaf2222222', 'io.metamask');
      };
      if (mode === 'announced' || mode === 'announced-only') {
        if (mode === 'announced') { window.phantom = { ethereum: phantom }; window.ethereum = phantom; }
        window.addEventListener('eip6963:requestProvider', window.announceWallets);
      }
    }, { mode });
    await page.goto(origin);
    return { page, context, errors };
  }
  const legacy = await fixture('legacy');
  await legacy.page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await legacy.page.getByRole('button', { name: 'Phantom', exact: true }).click();
  await legacy.page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
  assert.equal(await legacy.page.locator('[data-sign]').isDisabled(), true);
  await legacy.page.evaluate(() => { window.rejectSwitch = true; });
  await legacy.page.getByRole('button', { name: 'Switch to Robinhood Chain Testnet', exact: true }).click();
  await legacy.page.getByRole('alert').waitFor();
  assert.match(await legacy.page.getByRole('alert').innerText(), /cannot add Robinhood Chain Testnet/);
  assert.equal(await legacy.page.locator('[data-sign]').isDisabled(), true);
  await legacy.page.evaluate(() => { window.rejectSwitch = false; });
  await legacy.page.getByRole('button', { name: 'Switch to Robinhood Chain Testnet', exact: true }).click();
  await legacy.page.waitForFunction(() => !document.querySelector('[data-sign]').disabled);
  await legacy.page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await legacy.page.getByRole('button', { name: 'Connect wallet', exact: true }).waitFor();
  assert.equal(await legacy.page.locator('[data-sign]').isDisabled(), true);
  assert.equal(await legacy.page.evaluate(() => window.walletRequests.some((request) => /sign|sendTransaction/i.test(request.method))), false);
  assert.deepEqual(legacy.errors, []); await legacy.context.close();
  const dropdown = await fixture('announced');
  for (const width of [1280, 390, 320]) {
    await dropdown.page.setViewportSize({width,height:700});
    const trigger=dropdown.page.getByRole('button',{name:'Connect wallet',exact:true});
    const before=await trigger.boundingBox();
    await trigger.click(); await dropdown.page.getByRole('button',{name:'MetaMask',exact:true}).waitFor();
    await dropdown.page.waitForTimeout(200);
    assert.deepEqual(await trigger.boundingBox(),before,'Opening the picker does not change header geometry');
    const panel=await dropdown.page.getByRole('dialog',{name:'Choose a wallet'}).boundingBox();
    assert.ok(panel.x>=12 && panel.x+panel.width<=width-12 && panel.y>=12 && panel.y+panel.height<=688);
    await dropdown.page.mouse.click(width-5,690);
    await dropdown.page.getByRole('dialog',{name:'Choose a wallet'}).waitFor({state:'hidden'});
    await dropdown.page.waitForFunction(()=>document.querySelector('.fletch-wallet-trigger')?.getAttribute('aria-expanded')==='false');
  }
  assert.deepEqual(dropdown.errors, []); await dropdown.context.close();
  const announced = await fixture('announced');
  await announced.page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await announced.page.getByRole('button', { name: 'MetaMask', exact: true }).waitFor();
  assert.equal(await announced.page.getByRole('button', { name: 'Phantom', exact: true }).count(), 1, 'legacy + EIP6963 + generic aliases produce one wallet');
  await announced.page.keyboard.press('Escape');
  assert.equal(await announced.page.getByRole('button', { name: 'Connect wallet', exact: true }).evaluate((button) => button === document.activeElement), true);
  await announced.page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await announced.page.getByRole('button', { name: 'MetaMask', exact: true }).click();
  await announced.page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
  assert.ok(await announced.page.evaluate(() => window.walletRequests.some((request) => request.name === 'MetaMask' && request.method === 'wallet_requestPermissions')));
  assert.deepEqual(announced.errors, []); await announced.context.close();
  const only = await fixture('announced-only');
  await only.page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await only.page.getByRole('button', { name: 'Phantom', exact: true }).click();
  await only.page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
  assert.deepEqual(only.errors, []); await only.context.close();
  const late = await fixture('late');
  await late.page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await late.page.getByText('No compatible browser wallet was detected.', { exact: false }).waitFor();
  await late.page.evaluate(() => window.announceWallets());
  await late.page.getByRole('button', { name: 'MetaMask', exact: true }).waitFor();
  assert.deepEqual(late.errors, []); await late.context.close();
  const embedded = await fixture('none');
  await embedded.page.goto(origin + '/embedded');
  const preview = embedded.page.frameLocator('iframe');
  const hosted = preview.getByRole('link', { name: 'Open this app in a new tab' });
  await hosted.waitFor(); assert.equal(await hosted.getAttribute('target'), '_blank'); assert.equal(await hosted.getAttribute('href'), origin + '/');
  await embedded.page.goto(origin + '/?project-id');
  assert.equal(await embedded.page.getByRole('button', { name: 'Connect wallet', exact: true }).count(), 1);
  await embedded.page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  assert.deepEqual(await embedded.page.evaluate(() => ({ injected: window.modalOptions.enableInjected, discovery: window.modalOptions.enableEIP6963, modal: window.modalOpened.view, localChooser: document.querySelector('[aria-label="Detected browser wallets"]') !== null })), { injected: true, discovery: true, modal: 'Connect', localChooser: false });
  assert.deepEqual(embedded.errors, []); await embedded.context.close();
  assert.deepEqual(externalRequests, [], 'No external network requests occur in these controlled tests');
  console.log(JSON.stringify({ passed: ['legacy Phantom without project ID', 'EIP6963 Phantom/MetaMask discovery and deduplication', 'Solana-only providers excluded; late EIP6963 announcements supported', 'wrong-chain signing disabled', 'actual switch rejection displayed', 'switch/disconnect account state', 'Escape focus restoration', 'iframe hosted-app guidance', 'existing Reown modal retained with project ID'], realPairing: false, signingRequests: 0, externalRequests: 0 }));
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
