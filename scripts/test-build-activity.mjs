import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(join(process.cwd(), 'package.json'));
const { build } = require('esbuild');
const { chromium } = require(process.env.FLETCH_PLAYWRIGHT_PATH ?? 'playwright');
const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), 'fletch-build-activity-'));
let browser, server;
try {
  await build({ bundle: true, outfile: join(directory, 'client.js'), jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'fixtures', setup(builder) {
    builder.onResolve({ filter: /^(?:@\/lib\/auth\/use-hydrated-session|@\/components\/ui\/navigation-link)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'tsx', resolveDir: root, contents: path.includes('navigation-link') ? 'export default function Link(props){return <a {...props}/>}' : `import {useState,useEffect} from 'react'; export function useHydratedSession(){const [id,set]=useState('alice');useEffect(()=>{const update=()=>set(window.account);window.addEventListener('account',update);return()=>window.removeEventListener('account',update)},[]);return id?{user:{id}}:null;}` }));
  } }], stdin: { loader: 'tsx', resolveDir: root, contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {BuildActivity} from './components/dashboard/build-activity';
    window.account='alice'; window.mode='ok'; window.calls=[]; window.aborts=0;
    window.fetch=async(url, options)=>{window.calls.push(String(url));if(window.mode==='pending')return new Promise(resolve=>{window.finish=resolve;options.signal.addEventListener('abort',()=>window.aborts++)});if(window.mode==='error')return new Response('',{status:503});if(window.mode==='unauthorized')return new Response('',{status:401});return Response.json({builds:[{id:'one',projectId:'project-one',projectName:window.account+' app',status:window.mode==='paused'?'paused':'queued',ahead:3,since:new Date(Date.now()-120000).toISOString()}]})};
    createRoot(document.getElementById('root')).render(<BuildActivity/>);
  ` } });
  const js=await readFile(join(directory,'client.js'));const css=await readFile(join(directory,'client.css'));
  server=createServer((request,response)=>{if(request.url==='/client.js'){response.setHeader('content-type','text/javascript');response.end(js)}else if(request.url==='/client.css'){response.setHeader('content-type','text/css');response.end(css)}else response.end('<html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/client.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial;--color-raised:white;--color-ink:black;--color-line:#ddd;--color-hood:green;--color-hood-deep:darkgreen;--color-ink-faint:#666}button{border:0;background:transparent}a{color:inherit}</style></head><body><div id="root"></div><script src="/client.js"></script></body></html>')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.FLETCH_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);const card=page.getByRole('complementary',{name:'Your active builds'});await card.waitFor();
  assert.match(await card.innerText(), /In queue. 3 ahead/);
  assert.equal(await card.getByRole('link').getAttribute('href'),'/dashboard/build?project=project-one');
  const before=await card.boundingBox();const handle=page.getByRole('button',{name:'Move active build card'});await handle.focus();await page.keyboard.press('ArrowLeft');assert.equal((await card.boundingBox()).x,before.x-10);
  const rect=await handle.boundingBox();await page.mouse.move(rect.x+60,rect.y+20);await page.mouse.down();await page.mouse.move(100,150,{steps:8});await page.mouse.up();const moved=await card.boundingBox();assert.ok(moved.x<before.x-100);
  await page.reload();await card.waitFor();await page.waitForTimeout(100);assert.ok(Math.abs((await card.boundingBox()).x-moved.x)<1);
  await page.setViewportSize({width:320,height:568});const mobile=await card.boundingBox();assert.ok(mobile.x>=12&&mobile.x+mobile.width<=308&&mobile.y>=12&&mobile.y+mobile.height<=556);
  await page.evaluate(()=>{window.mode='paused';window.dispatchEvent(new Event('online'))});await page.getByText('Paused. Open build to review.').waitFor();
  await page.evaluate(()=>{window.mode='error';window.dispatchEvent(new Event('online'))});await page.getByRole('status').waitFor();assert.match(await card.innerText(),/Last known status: Paused/);
  await page.evaluate(()=>{window.mode='pending';window.dispatchEvent(new Event('online'))});await page.waitForTimeout(100);const calls=await page.evaluate(()=>window.calls.length);await page.evaluate(()=>window.dispatchEvent(new Event('online')));assert.equal(await page.evaluate(()=>window.calls.length),calls);
  await page.evaluate(()=>{window.account=null;window.dispatchEvent(new Event('account'))});await card.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.aborts),1);
  await page.evaluate(()=>{window.finish(Response.json({builds:[{id:'leaked',projectName:'alice private app'}]}));window.mode='ok';window.account='bob';window.dispatchEvent(new Event('account'))});await page.getByText('bob app').waitFor();assert.equal(await page.getByText('alice private app').count(),0);
  await page.evaluate(()=>{window.mode='unauthorized';window.dispatchEvent(new Event('online'))});await card.waitFor({state:'detached'});
  assert.deepEqual(errors,[]);console.log('PASS: queue, keyboard/pointer movement, persisted position, mobile bounds, paused/stale state, no overlapping requests, logout abort and account isolation');
} finally {await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true})}
