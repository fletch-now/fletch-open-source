// Actual console components, compiled app CSS and controlled SSE; no model or external requests.
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
const directory = await mkdtemp(join(tmpdir(), "fletch-build-console-"));
const projects = [
  { id: "fixture-one", name: "Reference board with a deliberately long project name", slug: "one", buildCount: 3, previewUrl: "/preview" },
  { id: "fixture-two", name: "Second app", slug: "two", buildCount: 1, previewUrl: null },
];
const messages = [
  { id: "u1", role: "user", content: "Create a reference board.", phase: "done", toolCalls: [], attachments: [{ name: "brief.txt", content: "The original fixture brief." }] },
  { id: "a1", buildId: "failed-build", role: "assistant", content: "", error: "The provider timed out.", phase: "done", toolCalls: [{ tool: "plan", input: "Earlier plan" }, { tool: "agent", input: "Earlier agent start" }] },
  { id: "u2", role: "user", content: "Try the revised board.", phase: "done", toolCalls: [] },
  { id: "a2", buildId: "current-build", role: "assistant", content: "The board is published.", phase: "done", toolCalls: [{ tool: "write", input: "Current board file" }] },
];
const routerStub = {
  name: "fixture-router",
  setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export function usePathname(){return window.location.pathname} export function useRouter(){return {push(url){window.dispatchEvent(new CustomEvent('fixture-route',{detail:url}))},replace(){},refresh(){}}}", loader: "js" }));
  },
};
let server;
let browser;
try {
  const clientFile = join(directory, "client.js");
  await build({ absWorkingDir: root, bundle: true, logLevel: "silent", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useEffect, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {BuildWorkspace} from './components/chat/build-workspace.tsx';
      import {authClient} from './lib/auth-client.ts';
      const session={user:{id:'console-fixture',name:'Fixture'},session:{id:'fixture',expiresAt:new Date(Date.now()+600000)}};
      const streaming=new URL(location.href).searchParams.has('stream');
      const resume=new URL(location.href).searchParams.has('resume');
      const messages=${JSON.stringify(messages)};
      if(streaming){messages[3]={...messages[3],content:'',phase:'planning',toolCalls:resume?Array.from({length:11},(_,i)=>({tool:'read',input:'Recorded file '+i})):[]};}
      const projects=${JSON.stringify(projects)};
      window.fixtureFiles=[]; window.fixtureFileBodies={}; window.fixtureFilesError=false; window.fixtureRequests=[]; window.stopRequests=[]; window.fixtureBuildBodies=[]; window.queueRequests=[]; window.fixtureAborts=0; window.railWrites=[]; window.enhancements=[]; window.enhancementAborts=0;
      const savePreference=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key==='fletch.build.chatWidth')window.railWrites.push(value);return savePreference.call(this,key,value)};
      window.fetch=async function fixtureFetch(url,options){
        const path=String(url); window.fixtureRequests.push(path);
        if(path.includes('get-session'))return Response.json(session);
        if(path.endsWith('/publish'))return Response.json({draft:null,live:{buildId:'current-build',url:location.origin+'/preview'},job:null});
        if(path==='/api/build-quotes')return Response.json({legacy:true});
        if(path.endsWith('/cancel')&&new URL(location.href).searchParams.has('queued'))return new Promise(resolve=>{window.queueRequests.push({body:JSON.parse(options.body),signal:options.signal,resolve})});
        if(path.endsWith('/cancel'))return new Promise(resolve=>{window.stopRequests.push({body:JSON.parse(options.body),contentType:options.headers?.['Content-Type'],resolve})});
        if(path==='/api/builds'&&new URL(location.href).searchParams.has('keyboard')){window.fixtureBuildBodies.push(JSON.parse(options.body));return new Promise(resolve=>{window.resolveBuildPost=()=>resolve(Response.json({error:'Controlled build refusal'},{status:422}))});}
        if(path==='/api/prompts/enhance')return new Promise((resolve,reject)=>{
          const request={resolve,reject,signal:options.signal};window.enhancements.push(request);
          options.signal.addEventListener('abort',()=>{window.enhancementAborts++});
        });
        if(path.endsWith('/stream'))return new Response(new ReadableStream({start(controller){
          window.emitBuild=(event,data)=>controller.enqueue(new TextEncoder().encode('event: '+event+'\\ndata: '+JSON.stringify(data)+'\\n\\n'));
          window.finishBuild=()=>controller.close();
          window.dropBuild=()=>controller.error(new TypeError('Controlled connection loss'));
          window.heartbeatBuild=()=>controller.enqueue(new TextEncoder().encode(':ka\\n\\n'));
          if(new URL(location.href).searchParams.has('stopping'))window.emitBuild('status',{step:'Stop requested. Waiting for cleanup.',buildState:'stopping'});
          if(new URL(location.href).searchParams.has('queued'))window.emitBuild('status',{step:'Queued',queue:{position:6,ahead:5,running:2,capacity:2}});
          options?.signal?.addEventListener('abort',()=>{window.fixtureAborts+=1;try{controller.close()}catch{}});
        }}),{headers:{'content-type':'text/event-stream'}});
        if(path==='/api/model-keys')return Response.json({keys:[{id:'kimi-fixture',version:new URL(location.href).searchParams.has('rotated')?2:1,provider:'kimi',model:'kimi-k2.5',custodyMode:'hosted',capabilities:{text:true,tools:true,images:true}}],platform:{available:true,capabilities:{text:true,tools:true,images:true}}});
        if(path.includes('/files')){if(window.fixtureFilesError)return Response.json({error:'Unavailable'},{status:503});const file=new URL(path,location.origin).searchParams.get('path');return Response.json(file?{content:window.fixtureFileBodies[file]??''}:{artifacts:window.fixtureFiles});}
        throw new Error('Unexpected fixture request: '+path);
      };
      authClient.hydrateSession(session);
      function Fixture(){
        const [project,setProject]=useState('fixture-one');
        useEffect(()=>{const navigate=(event)=>{window.lastNavigation=event.detail;setProject(new URL(event.detail,location.origin).searchParams.get('project')??undefined)};window.addEventListener('fixture-route',navigate);return()=>window.removeEventListener('fixture-route',navigate)},[]);
        return <BuildWorkspace projectId={project} projects={projects} initialMessages={project==='fixture-one'?messages:[]} initialNoContract={true} initialResult={project==='fixture-one'?{previewUrl:location.origin+'/preview'}:null} />;
      }
      const fixtureRoot=createRoot(document.getElementById('root'));
      window.unmountFixture=()=>fixtureRoot.unmount();
      fixtureRoot.render(<Fixture/>);
    ` }, platform: "browser", format: "iife", plugins: [routerStub], outfile: clientFile });
  const javascript = await readFile(clientFile);
  const css = (await postcss([tailwind({ base: root })]).process(await readFile(join(root, "app/globals.css"), "utf8"), { from: join(root, "app/globals.css") })).css;
  server = createServer(function serve(request, response) {
    if (request.url === "/client.js") { response.setHeader("content-type", "text/javascript"); response.end(javascript); return; }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css); return; }
    if (request.url === "/preview") { response.setHeader("content-type", "text/html"); response.end("<!doctype html><html><body>Published fixture</body></html>"); return; }
    response.setHeader("content-type", "text/html");
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><style>html,body{height:100%;margin:0}#root{height:calc(100% - 64px)}body{font-family:Arial,sans-serif}#fixture-global-header{height:64px}</style></head><body><div id="fixture-global-header" aria-hidden="true"></div><div id="root"></div><script src="/client.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.FLETCH_BROWSER_BIN, headless: true });
  const errors = [];
  const screenshots = process.env.FLETCH_SCREENSHOT_DIR;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  async function pageFor(width, height, query = "") {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin + query);
    await page.getByRole("button", { name: "Current project" }).waitFor();
    return page;
  }
  async function assertNoOverflow(page) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "The page must fit horizontally");
  }
  async function menu(page, name, key = "Enter") {
    const trigger = page.getByRole("button", { name, exact: true });
    await trigger.focus(); await page.keyboard.press(key);
    const panel = page.getByRole("menu", { name, exact: true });
    await panel.waitFor();
    await page.waitForFunction(() => document.activeElement?.hasAttribute("data-popover-item"));
    return panel;
  }
  async function assertLiveFiles(running) {
  await running.getByRole("button", { name: "Code", exact: true }).click();
  await running.evaluate(() => {
    window.fixtureFiles = [{path:'src/App.tsx',kind:'app',lines:20,preview:'export const first = 1;',contentHash:'first'}];
    window.fixtureFileBodies['src/App.tsx'] = 'export const first = 1;\n'.repeat(20);
    window.dispatchEvent(new Event('focus'));
  });
  await running.getByRole('button',{name:'Code',exact:true}).filter({hasText:'1'}).waitFor();
  await running.getByRole('button',{name:/^src[\/]App[.]tsx/}).click();
  await running.waitForFunction(()=>document.querySelector('#artifact-content')?.textContent.includes('export const first = 1;'));
  await running.evaluate(() => {
    window.fixtureFiles = [{path:'src/App.tsx',kind:'app',lines:20,preview:'export const second = 2;',contentHash:'second'}, {path:'src/Game.sol',kind:'contract',lines:1,preview:'contract Game {}',contentHash:'game'}];
    window.fixtureFileBodies['src/App.tsx'] = 'export const second = 2;\n'.repeat(20);
    window.dispatchEvent(new Event('focus'));
  });
  await running.getByRole('button',{name:'Code',exact:true}).filter({hasText:'2'}).waitFor();
  await running.waitForFunction(()=>document.querySelector('#artifact-content')?.textContent.includes('export const second = 2;'));
  assert.equal(await running.getByRole('tab',{name:/^App[.]tsx/}).getAttribute('aria-selected'),'true');
  await running.evaluate(()=>{window.fixtureFilesError=true;window.dispatchEvent(new Event('focus'));});
  await running.getByText('File updates paused. Retrying automatically.',{exact:true}).waitFor();
  assert.match(await running.getByRole('button',{name:'Code',exact:true}).innerText(),/^Code\s*2$/);
  await running.evaluate(()=>{window.fixtureFilesError=false;window.fixtureFiles=window.fixtureFiles.slice(0,1);window.dispatchEvent(new Event('focus'));});
  await running.getByRole('button',{name:'Code',exact:true}).filter({hasText:'1'}).waitFor();
  assert.equal(await running.evaluate(()=>window.fixtureAborts),0,'Background file updates preserve the stream');
  await running.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await running.getByRole('button',{name:'Code',exact:true}).locator('span').last().evaluate(el=>getComputedStyle(el).animationName),'none');
  await running.emulateMedia({reducedMotion:'no-preference'});
  assert.equal(await running.getByRole('button',{name:'Code',exact:true}).locator('span').last().evaluate(el=>getComputedStyle(el).animationName),'file-arrival');
  await running.getByRole('button',{name:'Chat',exact:true}).click();
  }
  if (process.env.FLETCH_TEST_SCOPE === 'files') {
    for (const width of [320,390,1280]) {
      const page=await pageFor(width,800,'/?stream=1');
      await page.waitForFunction(()=>typeof window.emitBuild==='function');
      await assertLiveFiles(page);
      await page.getByRole('button',{name:'Code',exact:true}).click();
      await assertNoOverflow(page);
      if(screenshots)await page.screenshot({path:join(screenshots,`live-files-${width}.png`)});
      await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log('PASS live file creation, edit, removal, retained selection/content, failure recovery, file counts and uninterrupted SSE at 320/390/1280px.');
  } else {
  for (const shortcut of ["Enter", "Control+Enter", "Meta+Enter"]) {
    const keyboardPage = await pageFor(390, 844, "?keyboard");
    await keyboardPage.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Chat", exact: true }).click();
    const input = keyboardPage.getByRole("textbox", { name: "Build prompt", exact: true });
    await input.fill("Build a reference board.");
    await keyboardPage.waitForFunction(() => !document.querySelector('button[aria-label^="Send prompt"]')?.disabled);
    await input.press("Shift+Enter");
    await input.press("A");
    assert.equal(await input.inputValue(), "Build a reference board.\nA", "Shift+Enter preserves multiline editing");
    await input.dispatchEvent("compositionstart");
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
    await input.dispatchEvent("compositionend");
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229 });
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", repeat: true });
    assert.equal(await keyboardPage.evaluate(() => window.fixtureBuildBodies.length), 0, "IME confirmation and held Enter never submit");
    const brief = "First requirement\nSecond requirement\nThird requirement\nFourth requirement\nFifth requirement\nSixth requirement";
    await input.fill("");
    await input.evaluate((node, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      node.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    }, brief);
    await keyboardPage.getByText("pasted-brief.txt", { exact: true }).waitFor();
    assert.match(await input.inputValue(), /Read brief\/pasted-brief\.txt in full/);
    await input.press(shortcut);
    await keyboardPage.waitForFunction(() => window.fixtureBuildBodies.length === 1);
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", repeat: true });
    await input.press("Enter");
    assert.equal(await keyboardPage.evaluate(() => window.fixtureBuildBodies.length), 1, "A pending build prevents repeated submissions");
    assert.deepEqual(await keyboardPage.evaluate(() => window.fixtureBuildBodies[0].attachments), [{ name: "pasted-brief.txt", content: brief }]);
    await keyboardPage.evaluate(() => window.resolveBuildPost());
    await keyboardPage.getByText("Controlled build refusal", { exact: true }).waitFor();
    await keyboardPage.close();
  }
  const queuedDraft = {
    prompt: "Use the full attached launchpad brief, including its wallet and contract requirements.",
    projectId: "fixture-one",
    selection: { billingMode: "own_key", custodyMode: "hosted", provider: "kimi", model: "kimi-k2.5", credentialId: "kimi-fixture", credentialVersion: 1 },
    attachments: [
      { name: "large-brief.txt", content: "Original launchpad requirement.\n".repeat(1500) },
      { kind: "image", name: "reference.png", mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO0sAAAAASUVORK5CYII=" },
    ],
  };
  async function queuedPage(width = 390, suffix = "") {
    const queued = await pageFor(width, 844, "?stream&queued&keyboard" + suffix);
    await queued.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Chat", exact: true }).click();
    await queued.getByText("#6 in queue", { exact: true }).waitFor();
    await queued.waitForFunction(() => document.querySelector('[aria-label="Build model"]')?.disabled === true);
    return queued;
  }
  const queued = await queuedPage(320);
  assert.equal(await queued.locator('[data-build-reply="current-build"] [data-build-loader]').count(), 0);
  assert.equal(await queued.locator('[data-build-reply="current-build"] details:not([data-build-timing])').count(), 0, "Queued work has no empty or invented build steps");
  await assertNoOverflow(queued);
  await queued.evaluate(() => window.emitBuild("status", { step: "Queued", queue: { position: 2, ahead: 1, running: 2, capacity: 2 } }));
  await queued.getByText("#2 in queue", { exact: true }).waitFor();
  await queued.reload();
  await queued.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Chat", exact: true }).click();
  await queued.getByText("#6 in queue", { exact: true }).waitFor();
  await queued.getByRole("button", { name: "Edit prompt", exact: true }).evaluate(node => { node.click(); node.click(); });
  assert.equal(await queued.evaluate(() => window.queueRequests.length), 1);
  assert.deepEqual(await queued.evaluate(() => window.queueRequests[0].body), { queuedOnly: true });
  const queuedInput = queued.getByRole("textbox", { name: "Build prompt", exact: true });
  assert.equal(await queuedInput.getAttribute("readonly"), "");
  assert.equal(await queuedInput.inputValue(), "", "Do not restore before queued cancellation succeeds");
  await queued.evaluate(draft => window.queueRequests[0].resolve(Response.json({ stopped: true, draft })), queuedDraft);
  await queued.waitForFunction(prompt => document.querySelector('textarea[aria-label="Build prompt"]').value === prompt, queuedDraft.prompt);
  await queued.getByRole("button", { name: /^Send prompt: Ship · 0 credits/ }).waitFor();
  assert.equal(await queuedInput.getAttribute("readonly"), null);
  await assertNoOverflow(queued);
  await queuedInput.press("Enter");
  await queued.waitForFunction(() => window.fixtureBuildBodies.length === 1);
  assert.deepEqual(await queued.evaluate(() => window.fixtureBuildBodies[0]), { ...queuedDraft });
  await queued.evaluate(() => window.resolveBuildPost());
  await queued.close();

  const queueRace = await queuedPage();
  const raceInput = queueRace.getByRole("textbox", { name: "Build prompt", exact: true });
  await queueRace.getByRole("button", { name: "Edit prompt", exact: true }).click();
  await queueRace.evaluate(() => window.emitBuild("phase", "planning"));
  await queueRace.evaluate(() => window.queueRequests[0].resolve(Response.json({ error: "Build already claimed" }, { status: 409 })));
  await queueRace.getByText("This build has already started. Your draft is unchanged.", { exact: true }).waitFor();
  assert.equal(await raceInput.inputValue(), "");
  assert.equal(await queueRace.locator('[data-build-reply="current-build"] [data-build-loader]').count(), 1);
  assert.equal(await queueRace.locator('[data-build-reply="current-build"] details:not([data-build-timing])').count(), 1, "Actual running work retains one inline disclosure");
  assert.equal(await queueRace.evaluate(() => window.fixtureAborts), 0, "A claim race never stops the running stream");
  assert.equal(await queueRace.getByRole("button", { name: "Cancel queue", exact: true }).count(), 0);
  await queueRace.evaluate(() => window.emitBuild("tool_use", { tool: "read", input: "Actual first agent work" }));
  await queueRace.getByText("Actual first agent work", { exact: true }).waitFor();
  await queueRace.close();

  const queueCancel = await queuedPage();
  const cancelInput = queueCancel.getByRole("textbox", { name: "Build prompt", exact: true });
  await cancelInput.fill("Preserve this separate unsent draft.");
  await queueCancel.getByRole("button", { name: "Edit prompt", exact: true }).click();
  assert.equal(await queueCancel.evaluate(() => window.queueRequests.length), 0, "Editing must not erase a separate draft");
  await queueCancel.getByRole("button", { name: "Cancel queue", exact: true }).click();
  await queueCancel.evaluate(draft => window.queueRequests[0].resolve(Response.json({ stopped: true, draft })), queuedDraft);
  await queueCancel.getByText("Removed from the queue.", { exact: true }).waitFor();
  assert.equal(await cancelInput.inputValue(), "Preserve this separate unsent draft.");
  assert.equal(await queueCancel.locator('[data-build-reply="current-build"] [data-build-loader]').count(), 0);
  await queueCancel.close();

  const platformQueue = await queuedPage();
  await platformQueue.getByRole("button", { name: "Cancel queue", exact: true }).click();
  await platformQueue.evaluate(draft => window.queueRequests[0].resolve(Response.json({ stopped: true, draft: { ...draft, selection: { billingMode: "platform" } }, refunded: true })), queuedDraft);
  await platformQueue.getByText("Removed from the queue. Reserved credit refunded.", { exact: true }).waitFor();
  await platformQueue.close();

  const legacyQueue = await queuedPage();
  await legacyQueue.getByRole("button", { name: "Edit prompt", exact: true }).click();
  await legacyQueue.evaluate(() => window.queueRequests[0].resolve(Response.json({ stopped: true, draft: null, refunded: false })));
  await legacyQueue.getByText("The queue was cancelled, but its saved draft or model connection could not be restored. Your original prompt and attachments remain in the conversation. Choose a connection before submitting again.", { exact: true }).waitFor();
  assert.equal(await legacyQueue.getByRole("textbox", { name: "Build prompt", exact: true }).inputValue(), "");
  assert.equal(await legacyQueue.getByText("Reserved credit refunded.", { exact: false }).count(), 0);
  assert.equal(await legacyQueue.evaluate(() => window.fixtureBuildBodies.length), 0);
  await legacyQueue.close();

  const rotatedQueue = await queuedPage(390, "&rotated");
  await rotatedQueue.getByRole("button", { name: "Edit prompt", exact: true }).click();
  await rotatedQueue.evaluate(draft => window.queueRequests[0].resolve(Response.json({ stopped: true, draft })), queuedDraft);
  await rotatedQueue.getByText("The queued model connection changed. Choose a connection before submitting again.", { exact: true }).waitFor();
  assert.equal(await rotatedQueue.getByRole("button", { name: /^Send prompt/ }).isDisabled(), true, "A rotated key cannot silently replace the accepted queued selection");
  assert.equal(await rotatedQueue.getByRole("textbox", { name: "Build prompt", exact: true }).inputValue(), queuedDraft.prompt);
  await rotatedQueue.close();

  const staleQueue = await queuedPage();
  await staleQueue.getByRole("button", { name: "Edit prompt", exact: true }).click();
  await staleQueue.evaluate(() => window.dispatchEvent(new CustomEvent("fixture-route", { detail: "/dashboard/build?project=fixture-two" })));
  await staleQueue.waitForFunction(() => window.queueRequests[0].signal.aborted);
  await staleQueue.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Chat", exact: true }).click();
  await staleQueue.evaluate(draft => window.queueRequests[0].resolve(Response.json({ stopped: true, draft })), queuedDraft);
  assert.equal(await staleQueue.getByRole("textbox", { name: "Build prompt", exact: true }).inputValue(), "", "A late old-project response cannot overwrite the new composer");
  await staleQueue.close();
  const enhancementPage = await pageFor(390, 844);
  await enhancementPage.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Chat", exact: true }).click();
  const enhancementInput = enhancementPage.getByRole("textbox", { name: "Build prompt", exact: true });
  const buildButton = enhancementPage.getByRole("button", { name: /^Send prompt/ });
  await enhancementInput.fill("Build an editable reference board.");
  await enhancementPage.locator('input[type="file"]').setInputFiles({ name: "keep.txt", mimeType: "text/plain", buffer: Buffer.from("Keep this attached requirement.") });
  await enhancementPage.getByText("keep.txt", { exact: true }).waitFor();
  await enhancementPage.waitForFunction(() => !document.querySelector('button[aria-label^="Send prompt"]')?.disabled);
  await enhancementPage.getByRole("button", { name: "Enhance prompt", exact: true }).click();
  assert.equal(await buildButton.isDisabled(), true);
  assert.equal(await enhancementInput.locator("xpath=ancestor::form").getAttribute("aria-busy"), "true");
  await enhancementPage.getByRole("status").filter({ hasText: "Enhancing prompt" }).waitFor();
  await enhancementInput.press("Enter");
  await enhancementInput.press("Control+Enter");
  await enhancementInput.press("Meta+Enter");
  await enhancementInput.evaluate(node => node.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(await enhancementPage.evaluate(() => window.fixtureRequests.filter(path => path === "/api/builds").length), 0, "Enhancement blocks keyboard and direct form submission");
  await enhancementPage.evaluate(() => window.enhancements[0].resolve(Response.json({ error: "Add what the app should do; your draft can still be built as written." }, { status: 422 })));
  await enhancementPage.getByRole("alert").filter({ hasText: "Add what the app should do" }).waitFor();
  assert.equal(await enhancementInput.inputValue(), "Build an editable reference board.");
  assert.equal(await enhancementPage.getByText("keep.txt", { exact: true }).count(), 1);
  assert.equal(await buildButton.isEnabled(), true);
  await assertNoOverflow(enhancementPage);

  await enhancementPage.getByRole("button", { name: "Enhance prompt", exact: true }).click();
  await enhancementPage.getByRole("button", { name: "Cancel enhancement", exact: true }).click();
  assert.equal(await enhancementPage.evaluate(() => window.enhancements[1].signal.aborted), true);
  assert.equal(await buildButton.isEnabled(), true);
  await enhancementPage.evaluate(() => window.enhancements[1].resolve(Response.json({ prompt: "Cancelled stale result must never replace this draft." })));
  assert.equal(await enhancementInput.inputValue(), "Build an editable reference board.");

  await enhancementPage.getByRole("button", { name: "Enhance prompt", exact: true }).click();
  await enhancementInput.fill("My newer manual edit stays in the composer.");
  assert.equal(await enhancementPage.evaluate(() => window.enhancements[2].signal.aborted), true);
  await enhancementPage.getByRole("button", { name: "Enhance prompt", exact: true }).click();
  await enhancementPage.evaluate(() => window.enhancements[2].resolve(Response.json({ prompt: "An older edit must not win." })));
  assert.equal(await buildButton.isDisabled(), true, "An old request cannot unlock the newer enhancement");
  await enhancementPage.evaluate(() => window.enhancements[3].resolve(Response.json({ prompt: "The valid enhanced version of the newer manual edit." })));
  await enhancementPage.waitForFunction(() => document.querySelector('textarea[aria-label="Build prompt"]').value === "The valid enhanced version of the newer manual edit.");
  assert.equal(await enhancementPage.getByText("keep.txt", { exact: true }).count(), 1);

  for (const failure of ["network", "empty", "provider"]) {
    await enhancementPage.getByRole("button", { name: "Enhance prompt", exact: true }).click();
    await enhancementPage.evaluate(kind => {
      const request = window.enhancements.at(-1);
      if (kind === "network") request.reject(new Error("Connection closed"));
      if (kind === "empty") request.resolve(Response.json({ prompt: "" }));
      if (kind === "provider") request.resolve(Response.json({ error: "The enhancement response was incomplete. Try again." }, { status: 502 }));
    }, failure);
    await enhancementPage.getByRole("alert").waitFor();
    assert.equal(await enhancementInput.inputValue(), "The valid enhanced version of the newer manual edit.");
    await enhancementPage.waitForFunction(() => !document.querySelector('button[aria-label^=\"Send prompt\"]')?.disabled);
    assert.equal(await buildButton.isEnabled(), true);
  }
  await enhancementPage.getByRole("button", { name: "Enhance prompt", exact: true }).click();
  await enhancementPage.evaluate(() => window.unmountFixture());
  assert.equal(await enhancementPage.evaluate(() => window.enhancements.at(-1).signal.aborted), true);
  await enhancementPage.evaluate(() => window.enhancements.at(-1).resolve(Response.json({ prompt: "No updates after unmount." })));
  assert.equal(await enhancementPage.evaluate(() => window.fixtureRequests.filter(path => path === "/api/builds").length), 0);
  await enhancementPage.close();
  const page = await pageFor(1280, 800);
  assert.equal(await page.locator("select").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Current project" }).innerText(), projects[0].name);
  const rail = await page.locator("[data-conversation-pane]").boundingBox();
  assert.equal(rail.width, 380);
  assert.equal(await page.locator("[data-conversation-pane] [data-project-pipeline]").count(), 0);
  assert.equal(await page.getByLabel("Toolchain verdict and publication receipts").isVisible(), true);
  await page.waitForFunction(() => document.querySelector("iframe")?.clientWidth > 100);
  const responsive = await page.locator("iframe").evaluate((frame) => ({ width: frame.clientWidth, height: frame.clientHeight, paneWidth: frame.parentElement.parentElement.clientWidth, paneHeight: frame.parentElement.parentElement.clientHeight, scale: frame.style.transform }));
  assert.ok(Math.abs(responsive.width - responsive.paneWidth) <= 1, "Responsive iframe fits the pane without a clipped border");
  assert.ok(Math.abs(responsive.height - responsive.paneHeight) <= 1);
  assert.equal(responsive.scale, "scale(1)");
  const separator = page.getByRole("separator", { name: "Resize conversation" });
  async function expectRail(width) {
    await page.waitForFunction((expected) => document.querySelector('[aria-label="Resize conversation"]')?.getAttribute("aria-valuenow") === String(expected), width);
    assert.equal((await page.locator("[data-conversation-pane]").boundingBox()).width, width);
  }
  async function beginDrag(targetPage, destination) {
    const handle = targetPage.getByRole("separator", { name: "Resize conversation" });
    const box = await handle.boundingBox();
    await targetPage.mouse.move(box.x + box.width / 2, box.y + 60);
    await targetPage.mouse.down();
    assert.equal(await handle.evaluate((node) => node.hasPointerCapture(1)), true);
    await targetPage.mouse.move(destination, box.y + 60);
    return handle;
  }
  await page.locator("textarea").fill("Keep this draft during resizing.");
  await page.evaluate(() => { window.originalPreview = document.querySelector("iframe"); window.originalComposer = document.querySelector("textarea"); });
  await beginDrag(page, 1200);
  await expectRail(640);
  assert.equal(await page.evaluate(() => window.railWrites.length), 0, "Dragging does not persist intermediate widths");
  assert.equal(await page.locator("iframe").evaluate((node) => getComputedStyle(node).pointerEvents), "none");
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.railWrites.length), 1);
  assert.equal(await page.locator("iframe").evaluate((node) => node === window.originalPreview), true);
  assert.equal(await page.locator("textarea").evaluate((node) => node === window.originalComposer), true);
  assert.equal(await page.locator("textarea").inputValue(), "Keep this draft during resizing.");
  await beginDrag(page, 350); await expectRail(350); await page.mouse.up();
  const savedBeforeCancel = await page.evaluate(() => window.railWrites.length);
  for (const cancellation of ["escape", "pointercancel", "lostcapture"]) {
    await beginDrag(page, 540); await expectRail(540);
    if (cancellation === "escape") await page.keyboard.press("Escape");
    if (cancellation === "pointercancel") await separator.dispatchEvent("pointercancel", { pointerId: 1 });
    if (cancellation === "lostcapture") { await separator.evaluate((node) => node.releasePointerCapture(1)); await page.mouse.move(545, 210); }
    await expectRail(350);
    await page.mouse.up();
    assert.equal(await page.locator("[data-rail-dragging]").count(), 0);
    assert.equal(await page.evaluate(() => window.railWrites.length), savedBeforeCancel, "Cancellation restores the width without saving");
  }
  await beginDrag(page, 350);
  const sameTurnWidth = await separator.evaluate((node) => {
    for (let index = 0; index < 50; index++) node.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 400 + index }));
    return node.getAttribute("aria-valuenow");
  });
  assert.equal(sameTurnWidth, "350", "Pointer movement waits for the animation frame");
  await expectRail(449);
  await page.keyboard.press("Escape"); await page.mouse.up(); await expectRail(350);
  await separator.press("End"); await expectRail(640);
  await page.setViewportSize({ width: 1024, height: 800 }); await expectRail(512);
  await assertNoOverflow(page);
  await page.setViewportSize({ width: 1280, height: 800 }); await expectRail(640);
  await page.evaluate(() => { document.getElementById("root").style.width = "900px"; }); await expectRail(450);
  assert.equal(await separator.getAttribute("aria-valuemax"), "450", "The maximum follows the workspace, not the viewport");
  await page.evaluate(() => { document.getElementById("root").style.width = ""; }); await expectRail(640);
  await separator.press("Home"); await expectRail(320);
  await separator.press("ArrowRight"); await expectRail(330);
  await separator.press("Shift+ArrowRight"); await expectRail(380);
  const writesBeforeKeyUp = await page.evaluate(() => window.railWrites.length);
  await separator.focus(); await page.keyboard.down("ArrowRight"); await expectRail(390);
  await page.setViewportSize({ width: 1400, height: 800 }); await expectRail(390);
  await page.setViewportSize({ width: 1280, height: 800 }); await expectRail(390);
  assert.equal(await page.evaluate(() => window.railWrites.length), writesBeforeKeyUp);
  await page.keyboard.up("ArrowRight");
  assert.equal(await page.evaluate(() => window.railWrites.length), writesBeforeKeyUp + 1);
  await beginDrag(page, 600); await expectRail(600);
  await page.setViewportSize({ width: 1024, height: 800 }); await expectRail(512);
  await page.mouse.up();
  assert.equal(await page.locator("[data-rail-dragging]").count(), 0);
  await page.setViewportSize({ width: 1280, height: 800 }); await expectRail(512);
  await page.reload(); await expectRail(512);
  await page.waitForFunction(() => document.querySelector("iframe")?.clientWidth > 100);
  assert.ok(await page.locator("iframe").evaluate((frame) => Math.abs(frame.clientWidth - frame.parentElement.parentElement.clientWidth) <= 1));
  if (screenshots) await page.screenshot({ path: join(screenshots, "preview-1280.png") });
  let panel = await menu(page, "Current project", "ArrowDown");
  assert.match(await panel.innerText(), /3 builds[\s\S]*Live/);
  await page.keyboard.press("End");
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Second app/);
  await page.keyboard.press("Home");
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Reference board/);
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "Current project" }).evaluate((node) => document.activeElement === node), true);
  panel = await menu(page, "Build model", "ArrowUp");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Manage model connections");
  await page.keyboard.press("ArrowDown");
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Platform model/);
  await panel.getByRole("menuitemradio", { name: /Kimi/ }).click();
  await panel.waitFor({ state: "hidden" });
  assert.match(await page.getByRole("button", { name: "Build model" }).getAttribute("title"), /Kimi.*0 Fletch credits/);
  assert.equal(await page.getByRole("button", { name: "Build model" }).evaluate((node) => document.activeElement === node), true);
  await page.locator("textarea").fill("Make this board clearer.");
  await menu(page, "Build model");
  await page.keyboard.press("Tab");
  assert.match(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), /Send prompt/);
  panel = await menu(page, "Preview settings");
  await panel.getByRole("menuitemradio", { name: /Phone/ }).click();
  await panel.waitFor({ state: "hidden" });
  panel = await menu(page, "Preview settings");
  assert.equal(await panel.getByRole("menuitemradio", { name: /Phone/ }).getAttribute("aria-checked"), "true");
  await panel.getByRole("menuitemradio", { name: "Responsive", exact: true }).click();
  panel = await menu(page, "Preview settings");
  await panel.getByRole("menuitemradio", { name: /Desktop/ }).click();
  await page.waitForFunction(() => document.querySelector("iframe")?.clientWidth === 1440);
  const fixed = await page.locator("iframe").evaluate((frame) => {
    const bounds = frame.getBoundingClientRect();
    const pane = frame.parentElement.parentElement.getBoundingClientRect();
    return { width: frame.clientWidth, height: frame.clientHeight, fits: bounds.width <= pane.width + 1 && bounds.height <= pane.height + 1 };
  });
  assert.deepEqual(fixed, { width: 1440, height: 900, fits: true });
  panel = await menu(page, "Preview settings");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "Preview settings" }).evaluate((node) => document.activeElement === node), true);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  assert.equal(await page.getByRole("separator", { name: "Resize conversation" }).count(), 0, "Chat has no resize handle");
  const failed = page.locator('[data-build-reply="failed-build"]');
  assert.equal(await failed.locator("details:not([data-build-timing])").count(), 1);
  assert.equal(await failed.locator("details:not([data-build-timing])").evaluate((node) => node.open), false);
  assert.match(await failed.locator("details:not([data-build-timing]) > summary").innerText(), /2 steps/);
  await failed.locator("details:not([data-build-timing]) > summary").click();
  assert.match(await failed.innerText(), /Earlier plan[\s\S]*Earlier agent start/);
  assert.equal((await failed.innerText()).includes("Current board file"), false);
  assert.equal(await page.locator("details:not([data-build-timing]) > summary").filter({ hasText: "Build details" }).count(), 2);
  const form = page.locator("form");
  const formBox = await form.boundingBox();
  assert.ok(formBox.width <= 760 && Math.abs(formBox.x + formBox.width / 2 - 640) <= 1, "Chat composer is centered and bounded");
  await assertNoOverflow(page);
  if (screenshots) await page.screenshot({ path: join(screenshots, "chat-1280.png") });
  panel = await menu(page, "Current project");
  await panel.getByRole("menuitemradio", { name: /Second app/ }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Current project"]')?.textContent === "Second app");
  assert.equal(await page.locator('[data-build-reply="failed-build"]').count(), 0, "Project navigation must clear the other project's reply");
  await page.close();

  for (const width of [320, 390]) {
    const mobile = await pageFor(width, 568);
    assert.equal(await mobile.getByRole("separator", { name: "Resize conversation" }).count(), 0, "Phone Preview has no resize handle");
    await mobile.getByRole("button", { name: "Chat", exact: true }).click();
    await assertNoOverflow(mobile);
    assert.equal(await mobile.getByRole("separator", { name: "Resize conversation" }).count(), 0);
    await mobile.getByRole("button", { name: /^Rename / }).click();
    await assertNoOverflow(mobile);
    await mobile.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await mobile.getByLabel("Toolchain verdict and publication receipts").isVisible(), true);
    const transcript = await mobile.locator("[data-conversation-pane] .overflow-y-auto").first().boundingBox();
    assert.ok(transcript.height >= 72, `Phone transcript remains usable below a 64px global header: ${transcript.height}`);
    const send = mobile.getByRole("button", { name: /Send prompt/ });
    const sendBox = await send.boundingBox();
    assert.ok(sendBox.x >= 0 && sendBox.x + sendBox.width <= width && sendBox.y >= 0 && sendBox.y + sendBox.height <= 568, "Build remains on screen");
    if (screenshots) await mobile.screenshot({ path: join(screenshots, `chat-${width}.png`) });
    await menu(mobile, "Build model");
    const menuBox = await mobile.getByRole("menu", { name: "Build model" }).boundingBox();
    assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= width && menuBox.y >= 0 && menuBox.y + menuBox.height <= 568, "Popover fits the viewport");
    await mobile.keyboard.press("Escape");
    await mobile.getByRole("button", { name: "Preview", exact: true }).click();
    await assertNoOverflow(mobile);
    await menu(mobile, "Preview settings");
    const gearBox = await mobile.getByRole("menu", { name: "Preview settings" }).boundingBox();
    assert.ok(gearBox.x >= 0 && gearBox.x + gearBox.width <= width && gearBox.y >= 0 && gearBox.y + gearBox.height <= 568);
    await mobile.keyboard.press("Escape");
    await mobile.close();
  }

  for (const stage of ["hosting", "deploying"]) {
    const stopping = await pageFor(390, 844, "/?stream=1");
    await stopping.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Chat", exact: true }).click();
    await stopping.waitForFunction(() => typeof window.emitBuild === "function");
    await stopping.evaluate(stage => window.emitBuild("tool_use", { tool: stage, input: "Controlled active stage" }), stage);
    await stopping.getByRole("button", { name: "Stop", exact: true }).click();
    await stopping.waitForFunction(() => window.stopRequests.length === 1);
    assert.deepEqual(await stopping.evaluate(() => window.stopRequests[0].body), { queuedOnly: false }, "Stop sends an explicit request compatible with the cancel endpoint");
    assert.equal(await stopping.evaluate(() => window.stopRequests[0].contentType), "application/json");
    assert.equal(await stopping.getByRole("button", { name: "Stopping build", exact: true }).isDisabled(), true);
    await stopping.evaluate(() => window.stopRequests[0].resolve(Response.json({ accepted: true, stopped: false, stopping: true }, { status: 202 })));
    await stopping.waitForTimeout(6500);
    assert.equal(await stopping.getByRole("button", { name: "Stopping build", exact: true }).isDisabled(), true, "202 does not fabricate terminal cleanup after six seconds");
    assert.equal(await stopping.evaluate(() => window.fixtureAborts), 0);
    await stopping.evaluate(() => window.finishBuild());
    await stopping.waitForFunction(() => window.fixtureRequests.filter(path => path.endsWith('/stream')).length === 2);
    assert.equal(await stopping.getByRole("button", { name: "Stopping build", exact: true }).isDisabled(), true, "EOF reconnects while Stop remains pending");
    assert.equal(await stopping.getByText("Stopped by you.", { exact: true }).count(), 0);
    await stopping.evaluate(() => window.emitBuild("error", { message: "Stopped by you. Source files retained.", canRetry: true }));
    await stopping.getByText("Stopped by you. Source files retained.", { exact: true }).waitFor();
    assert.equal(await stopping.getByRole("button", { name: "Stopping build", exact: true }).count(), 0);
    await stopping.close();
  }
  const stoppingReload = await pageFor(1280, 800, "/?stream=1&stopping=1");
  await stoppingReload.getByRole("button", { name: "Stopping build", exact: true }).waitFor();
  assert.equal(await stoppingReload.getByRole("button", { name: "Stopping build", exact: true }).isDisabled(), true);
  await stoppingReload.reload();
  await stoppingReload.getByRole("button", { name: "Stopping build", exact: true }).waitFor();
  assert.equal(await stoppingReload.getByRole("button", { name: "Stopping build", exact: true }).isDisabled(), true, "Persisted stopping status survives reload");
  await stoppingReload.close();

  const running = await pageFor(1280, 800, "/?stream=1");
  await running.getByRole("button", { name: "Chat", exact: true }).click();
  await running.waitForFunction(() => typeof window.emitBuild === "function");
  const current = running.locator('[data-build-reply="current-build"]');
  assert.equal(await current.locator("details:not([data-build-timing])").evaluate((node) => node.open), true);
  assert.equal(await current.locator("[data-build-loader]").count(), 1);
  await current.getByRole("status").filter({ hasText: "Fletch · working" }).waitFor();
  await running.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await current.locator("[data-build-loader]").evaluate((node) => getComputedStyle(node).animationName), "none");
  await running.emulateMedia({ reducedMotion: "no-preference" });
  assert.equal(await current.locator("[data-build-loader]").evaluate((node) => getComputedStyle(node).animationName), "spin");
  for (const mode of ["Preview", "Code", "Chat"]) {
    await running.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: mode, exact: true }).click();
    assert.equal(await running.evaluate(() => window.fixtureAborts), 0, "Changing modes preserves the active SSE connection");
  }
  await running.getByRole("button", { name: "Preview", exact: true }).click();
  await beginDrag(running, 700); await running.mouse.up();
  assert.equal(await running.evaluate(() => window.fixtureAborts), 0, "Resizing preserves the active SSE connection");
  await running.getByRole("button", { name: "Chat", exact: true }).click();
  await running.evaluate(() => window.emitBuild("tool_use", { tool: "write", input: "Streamed board change" }));
  await current.getByText("Streamed board change", { exact: true }).waitFor();
  assert.equal(await running.locator("[data-workspace-mode]").evaluate((node) => node.style.getPropertyValue("--rail-width")), "640px", "Stream updates preserve the resized width");
  assert.match(await current.locator("details:not([data-build-timing]) > summary").innerText(), /1 step/);
  assert.equal(await running.locator('[data-build-reply="failed-build"] details:not([data-build-timing])').evaluate((node) => node.open), false);
  await assertLiveFiles(running);
  const streamCount = await running.evaluate(() => window.fixtureRequests.filter((path) => path.endsWith('/stream')).length);
  await running.evaluate(() => window.finishBuild());
  await current.getByRole("status").filter({ hasText: "Fletch · reconnecting" }).waitFor();
  assert.match(await current.innerText(), /Streamed board change/);
  assert.equal(await current.locator("[data-build-loader]").count(), 1);
  await running.waitForFunction((count) => window.fixtureRequests.filter((path) => path.endsWith('/stream')).length === count + 1, streamCount);
  await running.evaluate(() => window.emitBuild("tool_use", { tool: "write", input: "Streamed board change" }));
  assert.match(await current.locator("details:not([data-build-timing]) > summary").innerText(), /1 step/);
  await running.evaluate(() => window.dropBuild());
  await current.getByRole("status").filter({ hasText: "Fletch · reconnecting" }).waitFor();
  await running.waitForFunction((count) => window.fixtureRequests.filter((path) => path.endsWith('/stream')).length === count + 2, streamCount);
  await running.evaluate(() => window.emitBuild("tool_use", { tool: "write", input: "Streamed board change" }));
  assert.equal(await running.evaluate(() => window.fixtureRequests.filter((path) => path === '/api/builds').length), 0, "Reconnection never submits a build");
  await running.evaluate(() => { window.emitBuild("text", { content: "Updated the board." }); window.emitBuild("done", {}); window.finishBuild(); });
  await running.waitForFunction(() => document.querySelector('[data-build-reply="current-build"] details:not([data-build-timing])')?.open === false);
  assert.equal(await current.locator("[data-build-loader]").count(), 0);
  assert.equal(await running.locator("details:not([data-build-timing]) > summary").filter({ hasText: "Build details" }).count(), 2);
  await current.locator("details:not([data-build-timing]) > summary").click();
  assert.match(await current.innerText(), /Streamed board change/);
  assert.equal((await current.innerText()).includes("Earlier plan"), false);
  const resumed = await pageFor(390, 844, "/?stream=1&resume=1");
  await resumed.getByRole("button", { name: "Chat", exact: true }).click();
  const resumedReply = resumed.locator('[data-build-reply="current-build"]');
  await resumedReply.getByRole("status").filter({ hasText: "Fletch · working" }).waitFor();
  assert.match(await resumedReply.locator("details:not([data-build-timing]) > summary").innerText(), /11 steps/);
  await resumed.reload();
  await resumed.getByRole("button", { name: "Chat", exact: true }).click();
  await resumedReply.getByRole("status").filter({ hasText: "Fletch · working" }).waitFor();
  assert.match(await resumedReply.locator("details:not([data-build-timing]) > summary").innerText(), /11 steps/);
  await resumed.clock.install();
  await resumed.evaluate(() => window.heartbeatBuild());
  await resumed.clock.fastForward(120_000);
  await resumed.evaluate(() => window.heartbeatBuild());
  await resumed.clock.fastForward(120_001);
  assert.equal(await resumed.evaluate(() => window.fixtureAborts), 0, "Heartbeat silence is distinct from quiet build events");
  assert.match(await resumedReply.locator("details:not([data-build-timing]) > summary").innerText(), /11 steps/);
  await resumed.clock.fastForward(120_001);
  await resumedReply.getByRole("status").filter({ hasText: "Fletch · reconnecting" }).waitFor();
  await resumed.clock.fastForward(1001);
  await resumed.waitForFunction(() => window.fixtureRequests.filter((path) => path.endsWith('/stream')).length === 2);
  await resumed.evaluate(() => window.emitBuild("tool_use",{id:"recorded-0",tool:"read",input:"Recorded file 0"}));
  await resumed.clock.runFor(1);
  assert.match(await resumedReply.locator("details:not([data-build-timing]) > summary").innerText(), /11 steps/, "A partial replay preserves already recorded steps");
  await resumed.evaluate(() => {
    for(let i=1;i<11;i++)window.emitBuild("tool_use",{id:"recorded-"+i,tool:"read",input:"Recorded file "+i});
    window.fullToolOutput=Array.from({length:90},(_,i)=>"Original retained output line "+i).join("\n");
    window.emitBuild("tool_result",{id:"recorded-10",summary:"Last file read",output:"Output of file 10",outputTruncated:false,outputChars:17});
    window.emitBuild("tool_result",{id:"recorded-0",summary:"First file read",output:window.fullToolOutput,outputTruncated:true,outputChars:10000});
  });
  const firstOutput=resumedReply.getByLabel("Recorded output for step 1", {exact:true});
  await firstOutput.waitFor();
  assert.equal(await firstOutput.textContent(),await resumed.evaluate(()=>window.fullToolOutput));
  assert.match(await firstOutput.locator("..").innerText(), /of 10000 characters/);
  assert.equal(await resumedReply.getByLabel("Recorded output for step 11", {exact:true}).textContent(),"Output of file 10", "Parallel results retain their call identity");
  assert.ok(await firstOutput.evaluate((node)=>node.scrollHeight>node.clientHeight&&node.clientHeight<=256),"Full retained output scrolls within the one build disclosure");
  assert.equal(await resumedReply.locator("details:not([data-build-timing])").count(),1);
  await resumed.evaluate(() => window.emitBuild("error", {message:"The server ended this build."}));
  await resumed.waitForFunction(() => !document.querySelector('[data-build-reply="current-build"] [data-build-loader]'));
  assert.match(await resumedReply.locator("details:not([data-build-timing]) > summary").innerText(), /11 steps/);
  await resumed.clock.fastForward(60_000);
  assert.equal(await resumed.evaluate(() => window.fixtureRequests.filter((path) => path.endsWith('/stream')).length), 2, "A terminal error stops reattachment even before HTTP closes");
  await resumed.close();
  const detached=await pageFor(1280,800,"/?stream=1");
  await detached.waitForFunction(()=>typeof window.dropBuild==='function');
  await detached.evaluate(()=>window.dropBuild());
  await detached.getByRole("status").filter({hasText:"Fletch · reconnecting"}).waitFor();
  await detached.evaluate(()=>window.unmountFixture());
  await detached.waitForTimeout(1100);
  assert.equal(await detached.evaluate(()=>window.fixtureRequests.filter(path=>path.endsWith('/stream')).length),1,"Unmount aborts reconnect backoff");
  await detached.close();
  assert.deepEqual(errors, []);
  await running.close();
  console.log("PASS actual BuildWorkspace: Stop during hosting/deployment, 202 pending beyond six seconds, disabled/loading, EOF reconnect and stopping reload; real queue positions/reload/start, exact large text+image/model restoration, cancel/edit races/repeats/project isolation/mobile; Enter/Ctrl/Command submission, Shift+Enter multiline, IME/repeat blocking and full long-paste attachment retention; enhancement loading/422/502/network/cancel/edit/unmount and blocked submit guards, keyboard popovers, project/model switching, preview settings, smooth380px-to-half rail,pointer/keyboard/cancel/viewport/stream resizing,end-only saved width, centered Chat, 320/390px fit below a64px header, responsive/fixed iframe bounds, uninterrupted mode switches, and per-build loaders/reduced-motion/reload/11-step replay, EOF/network/heartbeat reconnect without resubmission, terminal stop and automatic finish collapse.");
  }
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
