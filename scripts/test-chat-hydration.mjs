// Browser regression for a cached session arriving before the streamed console.
// Uses actual AgentChat/BetterAuth with synthetic data and local HTTP only.
// Set FLETCH_PLAYWRIGHT_PATH if Playwright is installed outside this checkout.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const { build } = require("esbuild");
const { chromium } = require(process.env.FLETCH_PLAYWRIGHT_PATH ?? "playwright");
const React = require("react");
const { renderToString } = require("react-dom/server");
const directory = await mkdtemp(join(tmpdir(), "fletch-chat-hydration-"));
const props = {
  mode: "app",
  projectId: "synthetic-hydration-fixture",
  initialMessages: [
    { id: "user", role: "user", content: "Create a page from the reference.", attachments: [{ name: "brief.txt", content: "Original brief" }], toolCalls: [], phase: "done" },
    { id: "assistant", role: "assistant", content: "Created the requested page.", toolCalls: [], phase: "done" },
  ],
};
const routerStub = {
  name: "fixture-router",
  setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export function useRouter(){return {push(){},replace(){},refresh(){}}}", loader: "js" }));
  },
};
const externalReact = {
  name: "server-react",
  setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({ path: require.resolve(args.path), external: true }));
  },
};
const common = {
  absWorkingDir: root,
  bundle: true,
  logLevel: "silent",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
};
let server;
let browser;
try {
  const serverFile = join(directory, "server.cjs");
  await build({ ...common, stdin: { contents: 'export {AgentChat} from "./components/chat/agent-chat.tsx";', resolveDir: root }, platform: "node", format: "cjs", plugins: [routerStub, externalReact], outfile: serverFile });
  const { AgentChat } = require(serverFile);
  const html = renderToString(React.createElement(AgentChat, props));
  assert.equal(html.includes('aria-label="Build model"'), false);
  const clientFile = join(directory, "client.js");
  await build({ ...common, stdin: { resolveDir: root, contents: `
    import React from "react";
    import { hydrateRoot } from "react-dom/client";
    import { AgentChat } from "./components/chat/agent-chat.tsx";
    import { authClient } from "./lib/auth-client.ts";
    const session = { user: { id: "synthetic-hydration-fixture", name: "Fixture" }, session: { id: "fixture", expiresAt: new Date(Date.now() + 60000) } };
    const warm = new URL(location.href).searchParams.get("warm") === "1";
    window.fetch = async function fixtureFetch(url) {
      if (String(url).includes("get-session")) return Response.json(session);
      return Response.json({ keys: [], platform: { available: true, capabilities: { text: true, tools: true, images: true } } });
    };
    if (warm) authClient.hydrateSession(session);
    else setTimeout(() => authClient.hydrateSession(session), 100);
    window.hydrationErrors = [];
    hydrateRoot(document.getElementById("root"), React.createElement(AgentChat, ${JSON.stringify(props)}), {
      onRecoverableError(error, info) { window.hydrationErrors.push({ message: error.message, componentStack: info.componentStack }); }
    });
  ` }, platform: "browser", format: "iife", plugins: [routerStub], outfile: clientFile });
  const javascript = await readFile(clientFile);
  server = createServer(function serve(request, response) {
    if (request.url === "/client.js") {
      response.setHeader("content-type", "text/javascript; charset=utf-8");
      response.end(javascript);
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html><body><div id="root">${html}</div><script src="/client.js"></script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.FLETCH_BROWSER_BIN, headless: true });
  for (const warm of [false, true]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", function localOnly(route) {
      if (route.request().url().startsWith(origin)) return route.continue();
      return route.abort();
    });
    await page.goto(`${origin}/?warm=${Number(warm)}`);
    await page.getByRole("button", { name: "Build model" }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Build model"]')?.disabled);
    assert.deepEqual(await page.evaluate(() => window.hydrationErrors), []);
    assert.deepEqual(errors, []);
    await page.getByRole("button", { name: "Build model" }).click();
    assert.equal(await page.getByRole("menuitemradio", { name: /Platform model/ }).getAttribute("aria-checked"), "true");
    await page.keyboard.press("Escape");
    await page.getByRole("menu", { name: "Build model" }).waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "Build model" }).evaluate((element) => document.activeElement === element), true);
    await page.close();
  }
  console.log("PASS AgentChat hydrates with cold and already-populated auth caches, then enables model controls.");
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
