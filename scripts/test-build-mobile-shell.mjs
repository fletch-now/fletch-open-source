import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const { build } = require("esbuild");
const { chromium } = require(process.env.FLETCH_PLAYWRIGHT_PATH ?? "playwright");
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const directory = await mkdtemp(join(tmpdir(), "fletch-mobile-shell-"));
let server;
let browser;
try {
  await build({
    absWorkingDir: root, bundle: true, logLevel: "silent", jsx: "automatic", platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {AppShell} from './components/dashboard/app-shell.tsx';
      import {BuildReply} from './components/chat/build-reply.tsx';
      const session={user:{id:'mobile-shell-fixture',name:'Fixture'},session:{id:'fixture',expiresAt:new Date(Date.now()+600000)}};
      window.fixtureSession=session;
      const active={id:'fixture-build',projectId:'fixture-project',projectName:'Fixture app',status:'building',step:'Reading source',since:new Date(Date.now()-240000).toISOString()};
      window.fetch=async function(url,options){
        if(options?.method && options.method!=='GET')throw Error('Fixture forbids mutation');
        if(String(url).includes('get-session'))return Response.json(session);
        if(String(url)==='/api/builds/active')return Response.json({builds:[active]});
        return Response.json({}, {status:503});
      };
      createRoot(document.getElementById('root')).render(<AppShell nav='dashboard' isAdmin={false}>
        <div className='p-4' data-build-reply='fixture-build'><BuildReply buildId='fixture-build' active content='' toolCalls={[{tool:'read',input:'Recorded source file'}]} /></div>
      </AppShell>);
    ` },
    plugins: [{ name: "fixture-boundaries", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/components\/wallet-button$/ }, () => ({ path: "wallet", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/lib\/auth-client$/ }, () => ({ path: "session", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
        let contents;
        if (args.path === "navigation") contents = "export function usePathname(){return location.pathname}";
        else if (args.path === "session") contents = "export const authClient={useSession(){return {data:window.fixtureSession}},signOut(){throw Error('No sign-out in fixture')}}";
        else contents = `import React from 'react';import {ConnectedPill} from './components/connected-pill.tsx';export function WalletButton(){return <ConnectedPill address={new URLSearchParams(location.search).has('handle')?undefined:'0x123456789012345678901234567890123456789012'} handle='A deliberately long connected account name' night={false} onDisconnect={async()=>{throw Error('No sign-out in fixture')}}/>}`;
        return { loader: "tsx", resolveDir: root, contents };
      });
    } }],
    outfile: join(directory, "client.js"),
  });
  const javascript = await readFile(join(directory, "client.js"));
  const css = (await postcss([tailwind({ base: root })]).process(await readFile(join(root, "app/globals.css"), "utf8"), { from: join(root, "app/globals.css") })).css;
  server = createServer(function serve(request, response) {
    if (request.url === "/client.js") { response.setHeader("content-type", "text/javascript"); response.end(javascript); return; }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css); return; }
    response.setHeader("content-type", "text/html");
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script src="/client.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.FLETCH_BROWSER_BIN, headless: true });
  const errors = [];
  for (const width of [320, 390, 1280]) {
    for (const suffix of ["", "?handle=1"]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.goto(`${origin}/dashboard/build${suffix}`);
      await page.locator('[data-build-loader]').waitFor();
      for (const reload of [false, true]) {
        if (reload) { await page.reload(); await page.locator('[data-build-loader]').waitFor(); }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Build console must fit at ${width}px${suffix}`);
        assert.equal(await page.locator('[aria-label="Recorded build steps"]').isVisible(), true);
        if (width < 640) {
          const header = page.locator('header').first();
          assert.equal(Math.round((await header.boundingBox()).height), 56);
          assert.equal(await header.getByRole("button", { name: "Open menu", exact: true }).isVisible(), true);
          assert.equal(await header.getByRole("link", { name: "Fletch home", exact: true }).isVisible(), true);
          assert.equal(await header.locator('[aria-haspopup="menu"]').isVisible(), true);
          assert.equal(await header.getByText("Building", { exact: true }).count(), 0, "The console already shows its own working indicator");
        }
      }
      if (process.env.FLETCH_SCREENSHOT_DIR && !suffix) {
        await mkdir(process.env.FLETCH_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.FLETCH_SCREENSHOT_DIR, `mobile-shell-${width}.png`), fullPage: true });
      }
      if (width < 640) {
        await page.getByRole("button", { name: "Open menu", exact: true }).click();
        await page.getByRole("dialog", { name: "Dashboard menu" }).waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await page.getByRole("dialog").count(), 0);
        assert.equal(await page.getByRole("button", { name: "Open menu", exact: true }).evaluate(node => node === document.activeElement), true);
        await page.getByRole("button", { name: "Open menu", exact: true }).click();
        await page.setViewportSize({ width: 844, height: 390 });
        await page.locator('[role="dialog"][aria-label="Dashboard menu"]').waitFor({ state: "detached" });
        assert.equal(await page.locator("main").evaluate(node => Boolean(node.closest("[inert]"))), false);
        assert.equal(await page.evaluate(() => document.body.style.overflow), "");
        await page.setViewportSize({ width, height: 844 });
      }
      await page.goto(`${origin}/dashboard/watch`);
      await page.locator('header').getByText("Building", { exact: true }).waitFor({ state: "attached" });
      assert.equal(await page.locator('header a[title^="Build in progress:"]').getAttribute("href"), "/dashboard/build?project=fixture-project");
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS actual AppShell/ConnectedPill/BuildReply: 320/390/1280px, address and long handle, reload, 56px mobile header, inline loader/steps, controls retained and activity link preserved off the console.");
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
