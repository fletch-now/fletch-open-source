import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=process.cwd(),require=createRequire(join(root,'package.json'));
const {build}=require('esbuild'),{chromium}=require(process.env.FLETCH_PLAYWRIGHT_PATH??'playwright');
const directory=await mkdtemp(join(tmpdir(),'fletch-watch-ui-'));
let server,browser;
try {
 await build({absWorkingDir:root,bundle:true,logLevel:'silent',jsx:'automatic',platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},
 stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {TelegramBotCard} from './components/dashboard/settings/telegram-bot-card';
 import {TelegramLinkCard} from './components/dashboard/watch/telegram-link-card';
 import {WatcherList} from './components/dashboard/watch/watcher-list';
 import {DeliveryList} from './components/dashboard/watch/delivery-list';
 const now=new Date();window.requests=[];window.refreshes=0;window.fail=false;
 window.fetch=async function(url,options){window.requests.push({url,...options});if(window.fail) return Response.json({error:'Controlled request failure'},{status:503});
 if(url==='/api/telegram/bot/link'){const body=JSON.parse(options.body);return Response.json(body.action==='prepare'?{token:'bot_123456789_controlled',url:'https://t.me/controlled_bot?start=controlled',expiresInSeconds:900}:{username:null});}return Response.json({ok:true});};
 const lastDelivery={createdAt:now,sentAt:null,status:'held',amount:null,txHash:'controlled'};
 const watcher={id:'fixture',name:'Robinhood catalog changes',kind:'listing_event',enabled:true,status:'active',symbol:'',delivery:'telegram',lastDelivery,address:'',threshold:'0',createdAt:now,updatedAt:now};
 createRoot(document.getElementById('root')).render(<main className='dashboard-settings mx-auto max-w-3xl space-y-6 p-4'>
 <section aria-label='Custom bot'><TelegramBotCard bot={location.search.includes('newbot')?null:{username:'controlled_bot',createdAt:now.toISOString()}} linked={false} linkedUsername={null}/></section>
 <section aria-label='Shared bot'><TelegramLinkCard configured linked linkedUsername={null}/></section>
 <WatcherList watchers={[watcher]}/><DeliveryList deliveries={[{id:'match',watcherId:'fixture',status:'held',createdAt:now,sentAt:null,lastError:null,payload:{kind:'authority',title:'TEST: Price feed only in the Robinhood app',registryUrl:'/registry/changes'}}]} emptyState={null}/>
 </main>);`},
 plugins:[{name:'boundaries',setup(builder){builder.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));builder.onResolve({filter:/^@\/components\/ui\/navigation-link$/},()=>({path:'link',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:root,contents:args.path==='navigation'?'export function useRouter(){return {refresh(){window.refreshes++}}}':"import React from 'react';export default function Link(props){return <a {...props}/>};"}));}}],outfile:join(directory,'client.js')});
 const javascript=await readFile(join(directory,'client.js'));
 const css=(await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(await readFile(join(root,'app/globals.css'),'utf8'),{from:join(root,'app/globals.css')})).css;
 server=createServer(function serve(request,response){if(request.url==='/client.js'){response.setHeader('content-type','text/javascript');response.end(javascript);return;}if(request.url==='/style.css'){response.setHeader('content-type','text/css');response.end(css);return;}response.setHeader('content-type','text/html');response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/client.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.FLETCH_BROWSER_BIN,headless:true});
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)});page.on('dialog',dialog=>dialog.accept());
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);await page.getByText('Last match:',{exact:false}).waitFor();
  assert.equal(await page.getByText('none yet',{exact:true}).count(),0);
  assert.equal(await page.getByText(/This notification is held/).count(),1);
  assert.equal(await page.getByText('your private chat',{exact:true}).count(),1,'Username is optional');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Create private link',exact:true}).click();
  await page.getByRole('link',{name:'Open private Telegram link'}).waitFor();
  assert.equal(await page.evaluate(()=>window.refreshes),0,'Preparing a challenge is not a completed link');
  await page.getByRole('button',{name:'Finish linking',exact:true}).click();
  await page.getByText('Chat linked.',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.refreshes),1);
  const posted=await page.evaluate(()=>window.requests.filter(item=>item.url==='/api/telegram/bot/link').map(item=>JSON.parse(item.body)));
  assert.deepEqual(posted,[{action:'prepare'},{token:'bot_123456789_controlled'}]);
  await page.evaluate(()=>window.fail=true);
  await page.getByRole('button',{name:'Remove bot',exact:true}).click();
  await page.getByText('Controlled request failure',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.refreshes),1,'Failed removal must not refresh as success');
  await page.getByRole('button',{name:'Unlink',exact:true}).click();
  assert.equal(await page.getByRole('alert').innerText(),'Controlled request failure');
  assert.equal(await page.getByText('your private chat',{exact:true}).count(),1);
  assert.deepEqual(errors,[]);
  if(width<640){
   await page.goto(origin+'?newbot=1');
   const input=page.getByLabel('Telegram bot token');await input.waitFor();
   assert.ok((await input.boundingBox()).width>=140,'Mobile bot token field remains usable beside its save action');
   assert.ok((await input.boundingBox()).height>=44,'Mobile bot token field retains its touch height');
   assert.equal(await input.evaluate(node=>getComputedStyle(node).fontSize),'16px');
  }
  await page.close();
 }
 console.log('PASS Watch dashboard at 320/390/1280px: held matches visible, username optional, private challenge required, failed unlink/removal remains linked, no overflow or browser errors. No external messages sent.');
} finally {await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
