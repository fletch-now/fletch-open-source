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
 import {WebhooksCard} from './components/dashboard/settings/webhooks-card';
 import {WatcherNotifications} from './components/dashboard/watch/watcher-notifications';
 const now=new Date();window.requests=[];window.refreshes=0;window.fail=false;window.malformed=false;
 const endpoint={id:'wh_controlled',name:'Production receiver',url:'https://example.com/a-long-webhook-path-with-receiver-token',enabled:true,secretPrefix:'whsec_demo',createdAt:now,lastDeliveredAt:now,lastError:null,lastErrorAt:null,lastTestAt:now,lastTestStatus:204,lastTestError:null,lastAlertAt:null,lastAlertStatus:null,lastAlertError:null};
 window.fetch=async function(url,options){window.requests.push({url,...options});await new Promise(resolve=>setTimeout(resolve,100));if(window.fail)return Response.json({error:'Controlled request failure'},{status:503});if(window.malformed)return new Response('bad json',{status:200});
 if(url.endsWith('/test'))return Response.json({ok:true,status:204,error:null});
 if(options.method==='POST')return Response.json({webhook:{...endpoint,id:'wh_new',name:JSON.parse(options.body).name,secret:'whsec_controlled_secret'}});
 if(options.method==='PATCH'&&JSON.parse(options.body).rotateSecret)return Response.json({webhook:{...endpoint,secret:'whsec_rotated_secret'}});
 return Response.json({ok:true});};
 createRoot(document.getElementById('root')).render(<main className='dashboard-settings mx-auto max-w-3xl space-y-6 p-4'>
 <WebhooksCard webhooks={[endpoint,{...endpoint,id:'wh_disabled',name:'Paused receiver',enabled:false}]} watchers={[{id:'fixture',name:'Robinhood app changes',enabled:true,webhookId:'wh_controlled'}]}/>
 <WatcherNotifications watcherId='fixture' delivery='telegram' webhookId={null} webhooks={[endpoint]}/>
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
  await page.goto(origin);await page.getByText('Latest watcher alert attempt',{exact:true}).first().waitFor();
  assert.equal(await page.getByText('No attempt recorded',{exact:true}).count(),2);
  assert.equal(await page.getByText('1 assigned watcher',{exact:true}).count(),1);
  assert.equal(await page.getByRole('link',{name:'Robinhood app changes · running'}).getAttribute('href'),'/dashboard/watch/fixture');
  assert.equal(await page.getByRole('link',{name:'Create watcher',exact:true}).getAttribute('href'),'/dashboard/watch/new?webhook=wh_controlled');
  const testButtons=page.getByRole('button',{name:'Send connection test',exact:true});
  assert.equal(await testButtons.nth(1).isDisabled(),true);
  await testButtons.first().click();
  await page.getByRole('button',{name:'Testing connection…'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Enable',exact:true}).isDisabled(),true);
  await page.getByRole('status').filter({hasText:'Connection test accepted (HTTP 204)'}).waitFor();
  assert.equal(await page.getByText('No attempt recorded',{exact:true}).count(),2,'A ping does not create alert history');
  await page.getByLabel('Endpoint URL').fill('https://example.com/new');
  await page.getByLabel('Name (optional)').fill('New receiver');
  await page.getByRole('button',{name:'Add endpoint',exact:true}).click();
  await page.getByText('Signing secret for New receiver',{exact:true}).waitFor();
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('blocked')}}}));
  await page.getByRole('button',{name:'Copy signing secret'}).click();
  await page.getByRole('alert').filter({hasText:'Clipboard access is unavailable'}).waitFor();
  await page.getByRole('button',{name:'I saved it. Hide secret'}).click();
  await page.getByText('Signing secret and endpoint removal',{exact:true}).first().click();
  await page.getByRole('button',{name:'Rotate secret',exact:true}).first().click();
  await page.getByText('Signing secret for Production receiver',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Delete endpoint',exact:true}).first().click();
  await page.getByText('Signing secret for Production receiver',{exact:true}).waitFor({state:'hidden'});
  await page.evaluate(()=>window.fail=true);
  await page.getByRole('button',{name:'Enable',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Controlled request failure'}).waitFor();
  await page.getByLabel('Notification channel').selectOption('wh_controlled');
  await page.getByRole('button',{name:'Save channel',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Controlled request failure'}).nth(1).waitFor();
  await page.evaluate(()=>window.fail=false);
  await page.getByRole('button',{name:'Save channel',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Notification channel saved'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(width<640){
   assert.equal(await page.getByLabel('Endpoint URL').evaluate(node=>getComputedStyle(node).fontSize),'16px');
   for(const control of await page.locator('button,input,select').all()){
    if(await control.isVisible())assert.ok((await control.boundingBox()).height>=43,'Touch target at least 44px');
   }
  }
  await page.evaluate(()=>window.malformed=true);
  await page.getByLabel('Endpoint URL').fill('https://example.com/incomplete');
  await page.getByRole('button',{name:'Add endpoint',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'The endpoint response was incomplete'}).waitFor();
  assert.equal(await page.getByLabel('Endpoint URL').inputValue(),'https://example.com/incomplete');
  await page.screenshot({path:`/tmp/fletch-webhook-audit-20260914/settings-fixture-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('PASS Webhook UI at 320/390/1280px: separate test/alert status, assigned watcher links, preselected creation link, disabled tests, pending actions, secret rotation/removal, clipboard errors, failed requests, channel selection and no overflow. No external messages sent.');
} finally {await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
