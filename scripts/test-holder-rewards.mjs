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
const directory = await mkdtemp(join(tmpdir(), 'fletch-holder-'));
let browser, server;
try {
  await build({ bundle: true, outfile: join(directory, 'client.js'), jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'session-fixture', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth\/use-hydrated-session$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'tsx', resolveDir: root, contents: `import {useState,useEffect} from 'react'; export function useHydratedSession(){const [id,set]=useState('alice');useEffect(()=>{const update=()=>set(window.account);window.addEventListener('account',update);return()=>window.removeEventListener('account',update)},[]);return id?{user:{id},wallet:id}:null;}` }));
  } }], stdin: { loader: 'tsx', resolveDir: root, contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {HolderRewardMonitor,LiveCreditBalance} from './components/holder-rewards/client';
    import {HolderRewardCard} from './components/holder-rewards/card'; import {Toaster} from 'sonner';
    window.account='alice';window.mode='off';window.calls=[];window.aborts=0;window.initial=1;
    window.fetch=async(url,options)=>{window.calls.push({url,method:options.method,body:options.body});if(window.mode==='pending')return new Promise(resolve=>{window.finish=resolve;options.signal.addEventListener('abort',()=>window.aborts++)});if(window.mode==='error')return new Response('',{status:503});if(window.mode==='unauthorized')return new Response('',{status:401});return Response.json({state:window.mode==='off'?'not_open':'granted',message:window.mode==='off'?'Holder credits are not open yet.':'10 holder credits added.',credits:10,thresholdUsd:'100',period:'once',checkedAt:new Date().toISOString(),priceAt:new Date().toISOString(),valueUsd:'101.00',wallet:window.account,tokenAddress:'0x'+'f'.repeat(40),chainId:4663,grantId:window.mode==='off'?null:window.account+'-grant',balance:window.mode==='off'?1:11})};
    const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<><HolderRewardMonitor/><LiveCreditBalance initial={window.initial}/><HolderRewardCard/><Toaster/></>);window.render();
  ` } });
  const js = await readFile(join(directory, 'client.js'));
  const styles = (await readFile('app/globals.css', 'utf8')).replace('@import "tailwindcss";',
    `@import "tailwindcss" source(none);\n@source "${root}/components/holder-rewards";`);
  const { css } = await require('postcss')([require('@tailwindcss/postcss')({ base: root })]).process(styles, { from: join(root, 'app/globals.css') });
  server=createServer((request,response)=>{if(request.url==='/client.js'){response.setHeader('content-type','text/javascript');response.end(js)}else if(request.url==='/client.css'){response.setHeader('content-type','text/css');response.end(css)}else response.end('<html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/client.css"><style>body{margin:0;padding:16px;font-family:Arial}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/client.js"></script></body></html>')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({executablePath:process.env.FLETCH_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByText('Holder credits are not open yet.',{exact:true}).waitFor();
  await page.getByText('1 credit',{exact:true}).waitFor();
  const first = await page.evaluate(()=>window.calls[0]);assert.equal(first.method,'POST');assert.equal(first.body,undefined);
  await page.evaluate(()=>{window.mode='grant';window.dispatchEvent(new Event('fletch:holder-check'))});
  await page.getByText('11 credits',{exact:true}).waitFor();
  await page.evaluate(()=>{window.initial=10;window.render()});
  await page.getByText('10 credits',{exact:true}).waitFor();
  await page.evaluate(()=>{window.mode='error';window.dispatchEvent(new Event('fletch:holder-check'))});
  await page.getByText('Holder credits could not be checked. Retrying shortly.',{exact:true}).waitFor();
  await page.getByText('10 credits',{exact:true}).waitFor();
  await page.evaluate(()=>{window.mode='pending';window.dispatchEvent(new Event('fletch:holder-check'))});
  const calls=await page.evaluate(()=>window.calls.length);
  await page.getByRole('button',{name:'Check holder credits'}).click();assert.equal(await page.evaluate(()=>window.calls.length),calls);
  await page.evaluate(()=>{window.account=null;window.dispatchEvent(new Event('account'))});
  await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>window.aborts),1);
  await page.evaluate(()=>{window.finish(Response.json({state:'granted',wallet:'alice-private',balance:999}));window.mode='off';window.account='bob';window.dispatchEvent(new Event('account'))});
  await page.getByText('Wallet: bob',{exact:true}).waitFor();assert.equal(await page.getByText('Wallet: alice-private',{exact:true}).count(),0);
  for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  assert.deepEqual(errors,[]);
  console.log('PASS: automatic holder check, balance refresh, newer server balance, failure retention, no overlapping checks, logout abort, account isolation and mobile overflow');
} finally {await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true})}
