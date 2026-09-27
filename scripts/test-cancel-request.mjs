import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root=process.cwd();
const require=createRequire(join(root,'package.json'));
const {build}=require('esbuild');
const temp=await mkdtemp(join(tmpdir(),'fletch-cancel-route-'));
const stubs={
 '@/lib/dal':`export async function getSession(){return globalThis.cancelFixture.signedIn?{user:{id:'owner'}}:null}`,
 '@/lib/db':`export const db={select(){return{from(){return{where(){return{async limit(){return globalThis.cancelFixture.row?[globalThis.cancelFixture.row]:[]}}}}}}}}`,
 '@/lib/db/schema':`export const builds={id:'id',userId:'userId',status:'status'}`,
 '@/lib/build/runner':`export async function cancelBuild(id,owner){globalThis.cancelFixture.calls.push({kind:'stop',id,owner});return{stopping:true}}`,
 '@/lib/build/queue':`export const ACTIVE_BUILD_STATUSES=['provisioning','building','compiling'];export async function cancelQueuedBuild(id,owner){globalThis.cancelFixture.calls.push({kind:'queue',id,owner});return globalThis.cancelFixture.queueResult}`,
 '@/lib/audit':`export async function recordAudit(event){globalThis.cancelFixture.audits.push(event)}`,
};
try{
 const outfile=join(temp,'route.cjs');
 await build({absWorkingDir:root,entryPoints:['app/api/builds/[id]/cancel/route.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',outfile,logLevel:'silent',plugins:[{name:'fixture-services',setup(builder){builder.onResolve({filter:/^@\/lib\//},args=>stubs[args.path]?{path:args.path,namespace:'fixture'}:undefined);builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
 // Resolve external Next/Drizzle dependencies from the reviewed application.
 process.env.NODE_PATH=join(root,'node_modules');require('node:module').Module._initPaths();
 const {POST}=require(outfile);
 let checks=0;
 async function run(body,status,kind=null,overrides={}){
  globalThis.cancelFixture={signedIn:true,row:{userId:'owner',status:'building'},calls:[],audits:[],queueResult:{draft:null,refunded:true},...overrides};
  const options={method:'POST'};
  if(body!==undefined){options.body=body;if(typeof body!=='string')options.duplex='half';}
  const response=await POST(new Request('http://fixture/api/builds/fixture/cancel',options),{params:Promise.resolve({id:'fixture'})});
  assert.equal(response.status,status,typeof body==='string'?body:'empty request');
  assert.deepEqual(globalThis.cancelFixture.calls.map(x=>x.kind),kind?[kind]:[]);
  if(kind==='stop')assert.deepEqual(await response.json(),{accepted:true,stopped:false,stopping:true});
  checks++;
 }
 await run(undefined,202,'stop');
 await run('',202,'stop');
 await run(new ReadableStream({start(controller){controller.close();}}),202,'stop');
 await run('{}',202,'stop');await run('{"queuedOnly":false}',202,'stop');
 await run('{"queuedOnly":true}',200,'queue',{row:{userId:'owner',status:'queued'}});
 for(const value of ['{','null','[]','true','"stop"','{"queuedOnly":"false"}','{"unexpected":true}',' '.repeat(1025)])await run(value,400);
 await run(undefined,401,null,{signedIn:false});
 await run(undefined,404,null,{row:{userId:'someone-else',status:'building'}});
 await run(undefined,404,null,{row:null});
 await run(undefined,409,null,{row:{userId:'owner',status:'succeeded'}});
 await run('{"queuedOnly":true}',409,'queue',{queueResult:null});
 console.log(JSON.stringify({checks,passed:true,scope:'Actual cancel route with isolated auth/database/runner boundaries; no production mutation.'}));
}finally{delete globalThis.cancelFixture;await rm(temp,{recursive:true,force:true});}
