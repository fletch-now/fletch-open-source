import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { zeroAddress, type PublicClient } from "viem";
process.env.TZ = "UTC";
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const hash = `0x${"ab".repeat(32)}`;
test("bounded priority refresh, shared readings and complete holder snapshots use isolated persisted evidence", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function integration(t) {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `priority_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!); url.searchParams.set("options", `-c search_path=${namespace},public`);
  process.env.DATABASE_URL = url.toString();
  const { pool, close } = await import("@/lib/db");
  t.after(async () => { await close(); await admin.query(`drop schema ${namespace} cascade`); await admin.end(); });
  for (const table of ["registry_assets", "registry_asset_state", "dex_tokens", "dex_pools", "lookalike_tokens", "market_pool_swap_metrics", "market_swap_index_state", "market_swap_events", "rate_counters"]) {
    await pool.query(`create table ${table} (like public.${table} including all)`);
  }
  await pool.query("alter table registry_assets add column if not exists metadata_checked_at timestamp");
  for (const file of ["0055_registry_priority.sql", "0056_market_swap_valuation.sql", "0058_registry_quote_observation.sql"]) await pool.query(await readFile(`drizzle/${file}`, "utf8"));
  await t.test("additive migration and Drizzle declarations agree on columns, checks and primary keys", async () => {
    const tables = await import("@/lib/db/registry-priority-schema");
    const { getTableConfig } = await import("drizzle-orm/pg-core");
    for (const table of Object.values(tables)) {
      const config = getTableConfig(table);
      const columns = await pool.query("select column_name from information_schema.columns where table_schema=$1 and table_name=$2",[namespace,config.name]);
      assert.deepEqual(columns.rows.map((row)=>row.column_name).sort(),config.columns.map((column)=>column.name).sort());
      const constraints = await pool.query("select conname,contype from pg_constraint where conrelid=$1::regclass",[config.name]);
      assert.deepEqual(constraints.rows.filter((row)=>row.contype==="c").map((row)=>row.conname).sort(),config.checks.map((check)=>check.name).sort());
      assert.deepEqual(constraints.rows.filter((row)=>row.contype==="p").map((row)=>row.conname),config.primaryKeys.map((key)=>key.getName()));
    }
  });
  await pool.query(`insert into registry_assets(id,chain_id,address,symbol,name,asset_type,source,decimals)
    select 'listed-'||n,4663,'0x'||lpad(to_hex(n),40,'0'),case when n=1 then 'USDG' else 'L'||n end,
      'Listed '||lpad(n::text,3,'0'),case when n=1 then 'stablecoin' else 'stock_token' end,'fixture',18 from generate_series(1,207) n`);
  await pool.query(`insert into dex_tokens(id,chain_id,address,symbol,name,decimals,bytecode_present) values
    ('token-1',4663,$1,'CASHCAT','Cash Cat',18,true),('token-2',4663,$2,'CASHCAT','Cash Cat',18,true),('token-3',4663,$3,'UNTRACKED','Untracked',18,true)`, [address(1001), address(1002), address(1003)]);
  for (const [id, token, depth, venue] of [[2001,1001,20_000,"uniswap_v3"], [2002,1002,11_000,"uniswap_v3"], [2003,1001,100_000,"uniswap_v4"]] as const) {
    await pool.query(`insert into dex_pools(id,chain_id,venue,pool_address,currency0,currency1,fee,tick_spacing,hooks,token_address,quote_asset_id,created_block,created_block_hash,depth_usd)
      values($1,4663,$2,$1,$3,$4,3000,60,$5,$3,'listed-1',10,$6,$7)`, [address(id),venue,address(token),address(1),zeroAddress,hash,depth]);
  }
  let changed = false;
  const pinned: bigint[] = [];
  let bytecodeReads = 0;
  const client = {
    getChainId: async () => 4663,
    getCode: async () => { bytecodeReads++; return "0x1234"; },
    getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: BigInt(100), hash: changed && blockNumber !== undefined ? `0x${"cd".repeat(32)}` : hash, timestamp: BigInt(Math.floor(Date.now()/1000)) }),
    multicall: async ({ contracts, blockNumber }: { contracts: Array<{address:string;functionName:string;args?:unknown[]}>;blockNumber:bigint }) => {
      pinned.push(blockNumber);
      return contracts.map((call) => {
        let result: unknown;
        if (call.functionName === "name") result = call.address === address(1001) || call.address === address(1002) ? "Cash Cat" : `Token ${call.address}`;
        else if (call.functionName === "symbol") result = call.address === address(1001) || call.address === address(1002) ? "CASHCAT" : "OTHER";
        else if (call.functionName === "decimals") result = 18;
        else if (call.functionName === "totalSupply") result = BigInt(1000) * BigInt(10)**BigInt(18);
        else if (call.functionName === "slot0" || call.functionName === "getSlot0") result = [BigInt(2)**BigInt(96),0,0,0];
        else if (call.functionName === "liquidity" || call.functionName === "getLiquidity") result = BigInt(1000)*BigInt(10)**BigInt(18);
        else if (call.functionName === "balanceOf") result = call.args?.[0] === address(2001) ? BigInt(20_000)*BigInt(10)**BigInt(18) : call.args?.[0] === address(2002) ? BigInt(11_000)*BigInt(10)**BigInt(18) : BigInt(0);
        return { status: "success", result };
      });
    },
  } as unknown as PublicClient;
  const { refreshPriorityUniverse, readPriorityPoolIds } = await import("./priority");
  const { readTokenMarkets, readTokenMarket } = await import("./token-markets");
  await t.test("all207 listings and fresh same-name strongest pool are materialized; V4 bound failure stays unavailable", async () => {
    const result = await refreshPriorityUniverse(4663, client);
    assert.equal(bytecodeReads, 10, "membership bounds identity admission and fills remaining identities in later passes");
    assert.equal(result.listed, 207); assert.equal(result.community,1); assert.equal(result.alternatives,1);
    assert.equal(result.failed, 0, "successful RPC reads that reject an unsafe derived estimate are not an outage");
    assert.equal(result.rejectedCount, 1);
    assert.deepEqual(result.rejectedReasons, { "The 1% estimate exceeds observable venue holdings or cannot be bounded.": 1 });
    const rejected = (await pool.query(`select pp.reason,pp.depth_usd,pp.selected,p.state_failures,p.state_retry_at
      from registry_priority_pools pp join dex_pools p on p.id=pp.pool_id where pp.pool_id=$1`, [address(2003)])).rows[0];
    assert.match(rejected.reason, /exceeds observable venue holdings/);
    assert.equal(rejected.depth_usd, null);
    assert.equal(rejected.selected, false);
    assert.equal(rejected.state_failures, 0, "a complete pinned pool-state observation does not increment RPC failure backoff");
    assert.equal(rejected.state_retry_at, null);
    assert.deepEqual(await readPriorityPoolIds(4663), [address(2001)]);
    assert.ok(pinned.every((block) => block === BigInt(100)));
    const row = await readTokenMarket(4663,address(1001));
    assert.equal(row?.v3QuoteHoldingsUsd.value,20_000); assert.equal(row?.v4OnePercentDepthUsd.value,null);
    assert.equal(row?.dominantAddress,address(1001)); assert.equal(row?.alternatives[0].address,address(1002));
    assert.equal(row?.decimals.value,18); assert.equal(row?.totalSupplyRaw.value,(BigInt(1000)*BigInt(10)**BigInt(18)).toString());
    assert.equal(row?.volumeUsd24h.value,null); assert.equal(row?.holders.value,null);
    assert.equal(row?.priceUsd.observation.blockNumber,"100");
    assert.equal(row?.priceUsd.observation.blockHash,hash);
    assert.ok(row?.priceUsd.observation.fetchedAt);
    assert.equal(row?.priceUsd.observation.coverage.status,"complete");
    assert.equal(row?.priceUsd.observation.inputs.find((input)=>input.name==="quoteUsd")?.value,1);
    assert.equal(row?.priceUsd.observation.inputs.find((input)=>input.name==="quoteUsd")?.observation.sourceAt,null);
    assert.equal(row?.selection.status,"current");
    assert.ok(row?.selection.selectedAt);
    assert.ok(row?.selection.expiresAt);
    assert.deepEqual(row?.marketCapUsd.observation.inputs.map((input)=>input.name),["decimals","totalSupplyRaw","burnedRaw","priceUsd"]);
    assert.equal(row?.marketCapUsd.observation.inputs.find((input)=>input.name==="totalSupplyRaw")?.observation.blockNumber,"100");
    assert.equal((await readTokenMarket(4663,address(1003)))?.address,address(1003));
    assert.equal((await readTokenMarkets(4663,{kind:"listed",page:9})).items.length,7);
    assert.equal((await readTokenMarkets(4663,{trust:"community"})).total,1);
  });
  await t.test("shared input cache recomputes expiry before filtering and sorting every page", async (cachedTest) => {
    const at=Date.now()+11_000;
    cachedTest.mock.timers.enable({apis:["Date"],now:at});
    const saved=(await pool.query("select quote_observation from registry_priority_pools where pool_id=$1",[address(2001)])).rows[0].quote_observation;
    try {
      await pool.query("update registry_priority_pools set quote_observation=jsonb_set(quote_observation,'{expiresAt}',to_jsonb($2::text)) where pool_id=$1",[address(2001),new Date(at+1000).toISOString()]);
      const [first, concurrent]=await Promise.all([readTokenMarkets(4663,{query:"CASHCAT",sort:"price",order:"asc"}),readTokenMarkets(4663,{query:"CASHCAT",sort:"price",order:"desc"})]);
      assert.equal(first.items[0].priceUsd.value,1);
      assert.equal(concurrent.items[0].priceUsd.asOf,first.items[0].priceUsd.asOf);
      const firstTime=first.items[0].priceUsd.asOf;
      const secondPage=await readTokenMarkets(4663,{kind:"listed",sort:"pools",order:"asc",page:2});
      const firstPage=await readTokenMarkets(4663,{kind:"listed",sort:"pools",order:"asc",page:1});
      assert.ok(firstPage.items.at(-1)!.address < secondPage.items[0].address,"equal pool counts use global address ordering before pagination");
      cachedTest.mock.timers.tick(2000);
      const expired=await readTokenMarkets(4663,{query:"CASHCAT",sort:"price"});
      assert.equal(expired.items[0].priceUsd.value,null);
      assert.equal(expired.items[0].priceUsd.observation.status,"stale");
      assert.equal(expired.items[0].priceUsd.asOf,firstTime,"cached rows retain the original source time");
      assert.equal(expired.items[0].marketCapUsd.value,null);
      assert.equal((await readTokenMarkets(4663,{query:"CASHCAT",data:"priced"})).total,0,"expiry is reapplied before numeric filters");
    } finally {
      await pool.query("update registry_priority_pools set quote_observation=$2 where pool_id=$1",[address(2001),saved]);
      cachedTest.mock.timers.reset();
    }
  });
  await t.test("expired selection withholds dominance while retaining selection evidence and current pool values", async () => {
    const previous=(await pool.query("select selected_at from registry_priority_tokens where address=$1",[address(1001)])).rows[0].selected_at;
    try {
      await pool.query("update registry_priority_tokens set selected_at=now()-interval '16 minutes' where address=$1",[address(1001)]);
      const row=await readTokenMarket(4663,address(1001));
      assert.equal(row?.dominantAddress,null);
      assert.equal(row?.selection.status,"stale");
      assert.ok(row?.selection.selectedAt);
      assert.equal(row?.priceUsd.value,1);
    } finally {
      await pool.query("update registry_priority_tokens set selected_at=$2 where address=$1",[address(1001),previous]);
    }
  });
  await t.test("pool prices and capitalization expire with their independently captured quote input", async () => {
    const { poolCoverage } = await import("./priority-jobs");
    const previous=(await pool.query("select quote_observation from registry_priority_pools where pool_id=$1",[address(2001)])).rows[0].quote_observation;
    try {
      const historicalQuote = { ...previous, method:"quote_token_usd_feed", sourceAt:new Date(Date.now()-3_600_000).toISOString() };
      await pool.query("update registry_priority_pools set quote_observation=$2 where pool_id=$1",[address(2001),historicalQuote]);
      const measured = await poolCoverage(4663);
      assert.equal(measured.price.current,1,"a recently fetched quote can have an older valid oracle source moment");
      assert.ok(measured.price.oldestInputAgeSeconds!>=3599,"coverage must report the older quote source input");
      await pool.query("update registry_priority_pools set quote_observation=jsonb_set(quote_observation,'{expiresAt}',to_jsonb($2::text)) where pool_id=$1",[address(2001),new Date(Date.now()-1000).toISOString()]);
      const expired=await readTokenMarket(4663,address(1001));
      assert.equal(expired?.priceUsd.value,null);
      assert.equal(expired?.priceUsd.observation.status,"stale");
      assert.equal(expired?.v3QuoteHoldingsUsd.value,null);
      assert.equal(expired?.marketCapUsd.value,null);
      const { GET: tokenGet } = await import("../../app/api/v1/tokens/[address]/route");
      const tokenResponse = await tokenGet(new Request(`https://fixture.invalid/api/v1/tokens/${address(1001)}`),{params:Promise.resolve({address:address(1001)})});
      assert.equal(tokenResponse.status,200);
      const tokenBody = await tokenResponse.json();
      assert.equal(tokenBody.market.depthUsd,null,"token compatibility depth cannot bypass independently expired quote evidence");
      assert.equal(tokenBody.market.priceUsd,tokenBody.reading.priceUsd.value);
      assert.ok(tokenBody.market.depthReason);
      assert.equal((await poolCoverage(4663)).price.current,0,"coverage and the API apply the same quote expiry");
      const { dexPoolsPage, deepestTokenPool, venueTotals } = await import("./authority/dex");
      const { publicPool } = await import("./authority/shape");
      const poolPage = await dexPoolsPage({ chainId:4663,limit:20,offset:0,kind:"all",tier:"all",sort:"depth",venue:null,q:null,floorUsd:0 },async()=>[]);
      const storedPool = poolPage.pools.find((entry)=>entry.id===address(2001))!;
      assert.equal(storedPool.stateObservationCurrent,false);
      assert.equal(publicPool(storedPool,new Map()).priceUsd,null);
      assert.equal(publicPool(storedPool,new Map()).depthUsd,null);
      assert.equal(poolPage.pools[0].id,address(2002),"independently expired quote depth cannot win SQL sorting");
      assert.equal((await deepestTokenPool(4663,address(1001)))?.priceUsd,null);
      const totals = await venueTotals(4663);
      assert.equal(totals.find((entry)=>entry.venue==="uniswap_v3")?.depthUsd,11000);
      const active = await dexPoolsPage({ chainId:4663,limit:20,offset:0,kind:"all",tier:"active",sort:"depth",venue:null,q:null,floorUsd:100 },async()=>[]);
      assert.equal(active.pools.some((entry)=>entry.id===address(2001)),false,"default USD floor requires a current quote input");
      await pool.query("update registry_priority_pools set quote_observation=$2 where pool_id=$1",[address(2001),{...historicalQuote,fetchedAt:new Date(Date.now()+3_600_000).toISOString()}]);
      assert.equal((await poolCoverage(4663)).price.current,0,"future fetch times cannot count as current");
      await pool.query("update registry_priority_pools set quote_observation=null where pool_id=$1",[address(2001)]);
      const legacy=await readTokenMarket(4663,address(1001));
      assert.equal(legacy?.priceUsd.value,1);
      assert.equal(legacy?.priceUsd.observation.coverage.status,"partial");
      assert.equal(legacy?.priceUsd.observation.inputs.find((input)=>input.name==="quoteUsd")?.observation.fetchedAt,null);
    } finally {
      await pool.query("update registry_priority_pools set quote_observation=$2 where pool_id=$1",[address(2001),previous]);
    }
  });
  await t.test("asset states and pool summaries reuse current canonical pool evidence and expire together", async () => {
    const savedQuote=(await pool.query("select quote_observation from registry_priority_pools where pool_id=$1",[address(2001)])).rows[0].quote_observation;
    const { stateFor, statesFor } = await import("./authority/read");
    const { publicState } = await import("./authority/shape");
    const { GET: assetPoolsGet } = await import("../../app/api/v1/chains/[chainId]/assets/[symbol]/pools/route");
    assert.equal((await pool.query("select 1 from registry_asset_state where asset_id='listed-2'")).rowCount,0);
    try {
      await pool.query("update dex_pools set asset_id='listed-2' where id=$1",[address(2001)]);
      await pool.query(`insert into registry_asset_state(asset_id,chain_id,address,dex_pool_id,dex_venue,dex_price_usd,dex_depth_usd,dex_checked_at,dex_premium_pct,feed_price)
        select 'listed-2',4663,'0x0000000000000000000000000000000000000002',id,venue,999,depth_usd,state_checked_at-interval '10 seconds',99,10 from dex_pools where id=$1`,[address(2001)]);
      const fresh=await stateFor("listed-2");
      assert.equal(fresh?.dexStateCurrent,true);
      assert.equal(Number(fresh?.dexPriceUsd),1,"new pool samples replace the older copied asset price without a freshness gap");
      assert.equal(fresh?.dexPremiumPct,null,"a newer pool observation cannot rejuvenate the previous premium calculation");
      assert.equal(fresh?.feedPrice,"10");
      await pool.query("update registry_priority_pools set quote_observation=jsonb_set(quote_observation,'{expiresAt}',to_jsonb($2::text)) where pool_id=$1",[address(2001),new Date(Date.now()-1000).toISOString()]);
      const expired=await stateFor("listed-2");
      assert.equal(expired?.dexPriceUsd,null);
      assert.equal(expired?.dexDepthUsd,null);
      assert.equal(expired?.feedPrice,"10");
      assert.equal(publicState(expired)?.dex?.stateCurrent,false);
      assert.equal((await statesFor(["listed-2"])).get("listed-2")?.dexDepthUsd,null);
      const response=await assetPoolsGet(new Request("https://fixture.invalid/api/v1/chains/4663/assets/L2/pools"),{params:Promise.resolve({chainId:"4663",symbol:"L2"})});
      assert.equal(response.status,200);
      const body=await response.json();
      assert.equal(body.best.stateCurrent,false);
      assert.equal(body.best.priceUsd,null);
      assert.equal(body.best.depthUsd,null);
      assert.equal(body.feedPriceUsd,10);
      await pool.query("update registry_priority_pools set quote_observation=$2 where pool_id=$1",[address(2001),savedQuote]);
      await pool.query("update dex_pools set canonical=false where id=$1",[address(2001)]);
      assert.equal((await stateFor("listed-2"))?.dexPriceUsd,null,"noncanonical pool identities cannot supply asset state");
    } finally {
      await pool.query("delete from registry_asset_state where asset_id='listed-2'");
      await pool.query("update dex_pools set asset_id=null,canonical=true where id=$1",[address(2001)]);
      await pool.query("update registry_priority_pools set quote_observation=$2 where pool_id=$1",[address(2001),savedQuote]);
    }
  });
  await t.test("normal nomination removes native-zero ERC-20 membership without deleting its pool or prior observations", async () => {
    const nativePool=address(2010);
    await pool.query(`insert into dex_tokens(id,chain_id,address,decimals,bytecode_present)
      values('native-fixture',4663,$1,null,false)`,[zeroAddress]);
    await pool.query(`insert into dex_pools(id,chain_id,venue,pool_address,currency0,currency1,fee,tick_spacing,hooks,token_address,quote_asset_id,created_block,created_block_hash,depth_usd)
      values($1,4663,'uniswap_v4',null,$2,$3,3000,60,$2,$2,'listed-1',10,$4,1000000000)`,[nativePool,zeroAddress,address(1),hash]);
    await pool.query(`insert into registry_priority_tokens(chain_id,address,role,group_key,dominant_address,selection_reason,rank,selected_at)
      values(4663,$1,'community',$1,$1,'Prior native candidate fixture',999,now())`,[zeroAddress]);
    await pool.query(`insert into registry_priority_pools(chain_id,pool_id,address,selected,method,depth_usd,source,observed_at,attempted_at,block_number,block_hash,factory_created_block,factory_created_hash)
      values(4663,$1,$2,true,'v4_bounded_one_percent',1000000000,'Prior native observation fixture',now(),now(),100,$3,10,$3)`,[nativePool,zeroAddress,hash]);
    const oldMetadata={bytecodePresent:false,reason:"Native currency has no ERC-20 metadata",asOf:new Date().toISOString()};
    await pool.query("insert into registry_token_observations(chain_id,address,metadata) values(4663,$1,$2)",[zeroAddress,oldMetadata]);
    const priorPool=(await pool.query("select * from dex_pools where id=$1",[nativePool])).rows[0];
    const priorObservation=(await pool.query("select * from registry_priority_pools where pool_id=$1",[nativePool])).rows[0];
    const guard={...client,getCode:async(args:Parameters<typeof client.getCode>[0])=>{
      assert.notEqual(args.address,zeroAddress,"native currency must not enter ERC-20 metadata reads");
      return client.getCode(args);
    },multicall:async(args:Parameters<typeof client.multicall>[0])=>{
      for(const call of args.contracts as readonly {address:string;args?:readonly unknown[]}[]){
        assert.notEqual(call.address,zeroAddress);
        assert.ok(!call.args?.includes(nativePool),"native pool is no longer nominated as an ERC-20 representative");
      }
      return client.multicall(args);
    }} as unknown as PublicClient;
    const result=await refreshPriorityUniverse(4663,guard);
    assert.equal(result.candidatePools,3);assert.equal(result.listed,207);assert.equal(result.community,1);
    assert.equal((await pool.query("select count(*)::int as n from registry_priority_tokens where address=$1",[zeroAddress])).rows[0].n,0);
    assert.deepEqual((await pool.query("select * from dex_pools where id=$1",[nativePool])).rows[0],priorPool);
    assert.deepEqual((await pool.query("select metadata from registry_token_observations where address=$1",[zeroAddress])).rows[0].metadata,oldMetadata);
    const after=(await pool.query("select * from registry_priority_pools where pool_id=$1",[nativePool])).rows[0];
    assert.equal(after.selected,false);
    assert.deepEqual(after,{...priorObservation,selected:false,selected_at:after.selected_at});
    assert.deepEqual(await readPriorityPoolIds(4663),[address(2001)]);
  });
  await t.test("fresh successful metadata is reused while every selected pool gets the same current raw snapshot", async () => {
    for (let pass = 0; pass < 30; pass++) {
      const previousReads = bytecodeReads;
      await refreshPriorityUniverse(4663, client);
      if (bytecodeReads === previousReads) break;
    }
    const before = bytecodeReads;
    await refreshPriorityUniverse(4663,client);
    assert.equal(bytecodeReads,before);
    const result = await pool.query("select price_usd,depth_usd,sqrt_price_x96,liquidity,state_checked_at from dex_pools where id=$1",[address(2001)]);
    assert.equal(Number(result.rows[0].depth_usd),20_000); assert.equal(Number(result.rows[0].price_usd),1);
    assert.equal(result.rows[0].sqrt_price_x96,(BigInt(2)**BigInt(96)).toString());
    assert.ok(result.rows[0].state_checked_at instanceof Date);
    assert.equal((await pool.query("select bytecode_present from dex_tokens where address=$1",[address(1001)])).rows[0].bytecode_present,true);
  });
  await t.test("selected refresh skips metadata and unselected pools while the universe lock is held", async () => {
    const {refreshSelectedPriorityPools}=await import("./priority");
    const owner=await pool.connect();
    await owner.query("select pg_advisory_lock(73462055)");
    const before=bytecodeReads;
    let calls=0;
    const selectedClient={...client,multicall:async(args:Parameters<typeof client.multicall>[0])=>{
      calls++;assert.equal(args.contracts.length,3);
      return client.multicall(args);
    }} as unknown as PublicClient;
    const members=(await pool.query("select address,role,selected_at from registry_priority_tokens order by address")).rows;
    try {
      assert.deepEqual(await refreshSelectedPriorityPools(4663,selectedClient),{pools:1,candidatePools:1,failed:0,rejectedCount:0,rejectedReasons:{}});
      assert.equal(bytecodeReads,before);assert.equal(calls,1);
      assert.deepEqual((await pool.query("select address,role,selected_at from registry_priority_tokens order by address")).rows,members);
    }finally{await owner.query("select pg_advisory_unlock(73462055)");owner.release();}
  });
  await t.test("an unavailable selected RPC batch stops after one attempt and retains complete observations", async () => {
    const {refreshSelectedPriorityPools}=await import("./priority");
    let calls=0;
    const failed={...client,multicall:async({contracts}:Parameters<typeof client.multicall>[0])=>{
      calls++;return contracts.map(()=>({status:"failure",error:new Error("Fixture transport unavailable")}));
    }} as unknown as PublicClient;
    const before=(await pool.query("select * from registry_priority_pools order by pool_id")).rows;
    await assert.rejects(refreshSelectedPriorityPools(4663,failed),/RPC batch unavailable/);
    assert.equal(calls,1);
    assert.deepEqual((await pool.query("select * from registry_priority_pools order by pool_id")).rows,before);
  });
  await t.test("one transport-failed pool subcall retains observations and the previous nomination timestamp", async () => {
    const before = (await pool.query("select * from registry_priority_pools order by pool_id")).rows;
    const members = (await pool.query("select * from registry_priority_tokens order by address")).rows;
    const failed = { ...client, multicall: async (args: Parameters<typeof client.multicall>[0]) => {
      const results = await client.multicall(args);
      return results.map((result, index) => index === 1 ? { status: "failure", error: new Error("Fixture aggregate chunk unavailable") } : result);
    } } as unknown as PublicClient;
    await assert.rejects(refreshPriorityUniverse(4663, failed), /RPC batch unavailable/);
    assert.deepEqual((await pool.query("select * from registry_priority_pools order by pool_id")).rows, before);
    assert.deepEqual((await pool.query("select * from registry_priority_tokens order by address")).rows, members);
  });
  await t.test("partial metadata transport and bytecode failures retain the entire prior observation", async () => {
    const { refreshPriorityMetadata } = await import("./priority-metadata");
    const before = (await pool.query("select * from registry_token_observations where address=$1", [address(1001)])).rows;
    for (const failBytecode of [false, true]) {
      const failed = { ...client,
        getCode: failBytecode ? async () => { throw new Error("Fixture bytecode transport failure"); } : client.getCode,
        multicall: async (args: Parameters<typeof client.multicall>[0]) => {
          const results = await client.multicall(args);
          return results.map((result, index) => !failBytecode && index === 1 ? { status: "failure", error: new Error("Fixture aggregate chunk failure") } : result);
        } } as unknown as PublicClient;
      await assert.rejects(refreshPriorityMetadata(4663, [address(1001)], failed), /RPC batch unavailable/);
      assert.deepEqual((await pool.query("select * from registry_token_observations where address=$1", [address(1001)])).rows, before);
    }
  });
  await t.test("a reverting individual contract remains per-pool evidence rather than a transport outage", async () => {
    const normalFailure = { ...client, multicall: async (args: Parameters<typeof client.multicall>[0]) => {
      const results = await client.multicall(args);
      return results.map((result, index) => {
        const call = args.contracts[index] as { address: string; functionName: string };
        return call.address === address(2002) && call.functionName === "liquidity"
          ? { status: "failure", error: { name: "ContractFunctionExecutionError", contractAddress: call.address, functionName: call.functionName } }
          : result;
      });
    } } as unknown as PublicClient;
    const result = await refreshPriorityUniverse(4663, normalFailure);
    assert.ok(result.failed >= 1, "an actual contract subcall failure still fails the job");
    assert.deepEqual(await readPriorityPoolIds(4663), [address(2001)]);
    await refreshPriorityUniverse(4663, client);
  });
  await t.test("a quote expiring during RPC cannot change selection; a refreshed feed is re-read before pricing", async (subtest) => {
    const initialNow = Date.now();
    let now = initialNow;
    subtest.mock.method(Date, "now", () => now);
    const quoteAsset = (await pool.query("select symbol,asset_type from registry_assets where id='listed-1'")).rows[0];
    await pool.query("update registry_assets set symbol='WETH',asset_type='wrapped_native' where id='listed-1'");
    await pool.query(`insert into registry_asset_state(asset_id,chain_id,address,feed_price,feed_updated_at,feed_checked_at,feed_stale)
      select id,chain_id,address,2,$1,$1,false from registry_assets where id='listed-1' on conflict(asset_id) do update set feed_price=2,feed_updated_at=$1,feed_checked_at=$1,feed_stale=false`, [new Date(initialNow - 179_000)]);
    const before = (await pool.query("select * from registry_priority_pools order by pool_id")).rows;
    const members = (await pool.query("select * from registry_priority_tokens order by address")).rows;
    function delayed(renew: boolean, elapsed = 2_000): PublicClient {
      return { ...client, multicall: async (args: Parameters<typeof client.multicall>[0]) => {
        const results = await client.multicall(args);
        now = initialNow + elapsed;
        if (renew) await pool.query("update registry_asset_state set feed_price=3,feed_checked_at=$1 where asset_id='listed-1'", [new Date(now)]);
        return results;
      } } as unknown as PublicClient;
    }
    try {
      await assert.rejects(refreshPriorityUniverse(4663, delayed(false)), /quote expired/);
      assert.deepEqual((await pool.query("select * from registry_priority_pools order by pool_id")).rows, before);
      assert.deepEqual((await pool.query("select * from registry_priority_tokens order by address")).rows, members);
      now = initialNow;
      await assert.rejects(refreshPriorityUniverse(4663, delayed(true, 181_000)), /pool snapshot expired/);
      assert.deepEqual((await pool.query("select * from registry_priority_pools order by pool_id")).rows, before);
      assert.deepEqual((await pool.query("select * from registry_priority_tokens order by address")).rows, members);
      now = initialNow;
      await pool.query("update registry_asset_state set feed_checked_at=$1 where asset_id='listed-1'", [new Date(initialNow - 179_000)]);
      await refreshPriorityUniverse(4663, delayed(true));
      const recorded = (await pool.query("select quote_observation,depth_usd from registry_priority_pools where pool_id=$1", [address(2001)])).rows[0];
      assert.equal(recorded.quote_observation.value, 3);
      assert.equal(recorded.quote_observation.fetchedAt, new Date(now).toISOString());
      assert.equal(Number(recorded.depth_usd), 60_000);
    } finally {
      subtest.mock.restoreAll();
      await pool.query("update registry_assets set symbol=$1,asset_type=$2 where id='listed-1'", [quoteAsset.symbol, quoteAsset.asset_type]);
      await pool.query("delete from registry_asset_state where asset_id='listed-1'");
      await refreshPriorityUniverse(4663, client);
    }
  });
  await t.test("a slow failed nomination cannot overwrite newer selected state or its legacy mirror", async () => {
    const {refreshSelectedPriorityPools}=await import("./priority");
    let enter!:()=>void;let release!:()=>void;
    const entered=new Promise<void>((resolve)=>{enter=resolve;});
    const gate=new Promise<void>((resolve)=>{release=resolve;});
    function at(block:number,slow:boolean):PublicClient {
      return {...client,getBlock:async()=>({number:BigInt(block),hash:`0x${block.toString(16).padStart(64,"0")}`,timestamp:BigInt(Math.floor(Date.now()/1000))}),
        multicall:async(args:Parameters<typeof client.multicall>[0])=>{
          if(slow){enter();await gate;}
          const values=await client.multicall(args);
          return values.map((value,index)=>{
            const contract=args.contracts[index] as {functionName:string;args?:readonly unknown[]};
            if(contract.functionName==="balanceOf"&&contract.args?.[0]===address(2001))return slow?{status:"failure",error:new Error("Delayed old pool read failed")}
              :{status:"success",result:BigInt(55_000)*BigInt(10)**BigInt(18)};
            return value;
          });
        }} as unknown as PublicClient;
    }
    const old=refreshPriorityUniverse(4663,at(300,true));
    await entered;
    try{await refreshSelectedPriorityPools(4663,at(400,false));}finally{release();}
    await assert.rejects(old, /RPC batch unavailable/);
    const observation=(await pool.query("select block_number,depth_usd,reason from registry_priority_pools where pool_id=$1",[address(2001)])).rows[0];
    assert.equal(observation.block_number,"400");assert.equal(Number(observation.depth_usd),55_000);assert.equal(observation.reason,null);
    assert.equal(Number((await pool.query("select depth_usd from dex_pools where id=$1",[address(2001)])).rows[0].depth_usd),55_000);
    assert.deepEqual(await readPriorityPoolIds(4663),[address(2001)]);
  });
  await t.test("selected-pool measured volume sorts before unavailable rows and preserves true zero counts", async (volumeTest) => {
    volumeTest.mock.timers.enable({apis:["Date"],now:Date.now()+30_000});
    await pool.query(`insert into market_swap_index_state(chain_id,live_start_block,live_start_at,through_block,through_at,through_hash,window_start_block,window_start_at)
      values(4663,1,now()-interval '2 days',100,now(),$1,1,now()-interval '24 hours')`,[hash]);
    await pool.query(`insert into market_pool_swap_metrics(chain_id,pool_id,enrolled_from_block,covered_from_block,factory_created_block,factory_created_hash,
      as_of_block,as_of_at,window_start_at,coverage_complete,swaps,transactions,volume_usd,volume_valuation)
      values(4663,$1,1,1,10,$2,100,now(),now()-interval '24 hours',true,0,0,0,$3)`,[address(2001),hash,{method:"usdg_nominal",source:"USDG notional at1USDG=$1",reason:null}]);
    const page = await readTokenMarkets(4663,{sort:"volume"});
    assert.equal(page.items[0].address,address(1001)); assert.equal(page.items[0].volumeUsd24h.value,0);
    assert.equal(page.items[0].transactions24h.value,0); assert.equal(page.items[0].swaps24h.value,0);
    assert.equal(page.items[0].volumeScope,"selected_pool"); assert.equal(page.total,208);
    const quiet = await readTokenMarkets(4663, { activity: "quiet", minVolumeUsd: 0, depth: "v3_10k" });
    assert.equal(quiet.total, 1);
    assert.equal(quiet.items[0].address, address(1001));
    assert.equal((await readTokenMarkets(4663, { activity: "traded" })).total, 0);
    const { GET: marketsGet } = await import("../../app/api/v1/chains/[chainId]/markets/route");
    const { GET: filtersGet } = await import("../../app/api/v1/chains/[chainId]/markets/filters/route");
    const context = { params: Promise.resolve({ chainId: "4663" }) };
    const response = await marketsGet(new Request("https://fixture.invalid/api/v1/chains/4663/markets?activity=quiet&minVolumeUsd=0&depth=v3_10k"), context);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.deepEqual(json.items, quiet.items, "API and page read model apply identical filters and observations");
    assert.deepEqual(json.appliedFilters, { activity: "quiet", depth: "v3_10k", minVolumeUsd: "0" });
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    const discovery = await filtersGet(new Request("https://fixture.invalid/api/v1/chains/4663/markets/filters"), context);
    assert.equal(discovery.status, 200);
    assert.ok((await discovery.json()).filters.activity.options.some((option: { value: string }) => option.value === "quiet"));
    const invalid = await marketsGet(new Request("https://fixture.invalid/api/v1/chains/4663/markets?activity=trending"), context);
    assert.equal(invalid.status, 400);
    await pool.query("update market_swap_index_state set through_at=now()-interval '3 minutes'");
    volumeTest.mock.timers.tick(10_001); // Refresh the bounded raw-input snapshot after the database correction.
    assert.equal((await readTokenMarket(4663,address(1001)))?.volumeUsd24h.value,null);
    assert.equal((await readTokenMarkets(4663, { activity: "quiet", minVolumeUsd: 0 })).total, 0, "Expired zero-volume windows leave numeric filters immediately");
  });
  await t.test("factory reorg prevents stale pool evidence and enrollment", async () => {
    await pool.query("update dex_pools set created_block_hash=$1 where id=$2", [`0x${"ef".repeat(32)}`,address(2001)]);
    assert.deepEqual(await readPriorityPoolIds(4663),[]);
    assert.equal((await readTokenMarket(4663,address(1001)))?.v3QuoteHoldingsUsd.value,null);
    const { deepestTokenPool } = await import("./authority/dex");
    assert.equal((await deepestTokenPool(4663,address(1001)))?.priceUsd,null,"mirrored state from a different factory identity is withheld");
    await pool.query("update dex_pools set created_block_hash=$1 where id=$2", [hash,address(2001)]);
  });
  await t.test("metadata reorg rejects snapshot before observation writes", async () => {
    changed=true;
    const { refreshPriorityMetadata } = await import("./priority-metadata");
    await assert.rejects(refreshPriorityMetadata(4663,[address(9999)],client),/snapshot changed/);
    assert.equal((await pool.query("select count(*)::int as n from registry_token_observations where address=$1",[address(9999)])).rows[0].n,0);
    changed=false;
  });
  await t.test("supply reorg and unavailable aggregate retain every published input", async () => {
    const { refreshPrioritySupply } = await import("./priority-metadata");
    const before = (await pool.query("select metadata from registry_token_observations where address=$1", [address(1001)])).rows[0].metadata;
    changed = true;
    await assert.rejects(refreshPrioritySupply(4663, [address(1001)], client), /snapshot changed/);
    changed = false;
    const unavailable = { ...client, multicall: async () => Array.from({ length: 3 }, () => ({ status: "failure" })) } as unknown as PublicClient;
    await assert.rejects(refreshPrioritySupply(4663, [address(1001)], unavailable), /batch unavailable/);
    assert.deepEqual((await pool.query("select metadata from registry_token_observations where address=$1", [address(1001)])).rows[0].metadata, before);
  });
  const { refreshPriorityHolders } = await import("./priority-holders");
  await t.test("default holder transport charges the shared daily budget before loopback RPC dispatch", async () => {
    let requests=0;
    const server=createServer(async(request,response)=>{
      let body="";for await(const chunk of request)body+=chunk;
      const message=JSON.parse(body);requests++;
      response.setHeader("content-type","application/json");response.end(JSON.stringify({jsonrpc:"2.0",id:message.id,result:"0x1237"}));
    });
    await new Promise<void>((resolve)=>server.listen(0,"127.0.0.1",resolve));
    const previous=process.env.RPC_LOG_URL_4663;
    process.env.RPC_LOG_URL_4663=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const {priorityHolderClient}=await import("./priority-holders");
      const {WATCH_LIMITS}=await import("@/lib/watch/types");
      const client=priorityHolderClient(4663);
      assert.equal(await client.getChainId(),4663);assert.equal(requests,1);
      assert.equal((await pool.query("select count from rate_counters where bucket='rpc:day'")).rows[0].count,1);
      await pool.query("update rate_counters set count=$1 where bucket='rpc:day'",[WATCH_LIMITS.rpcCallsPerDay]);
      await assert.rejects(client.getBlockNumber({cacheTime:0}),/Daily RPC budget/);
      assert.equal(requests,1);
    } finally {
      if(previous===undefined)delete process.env.RPC_LOG_URL_4663;else process.env.RPC_LOG_URL_4663=previous;
      await new Promise<void>((resolve,reject)=>server.close((error)=>error?reject(error):resolve()));
    }
  });
  let supply = BigInt(10); let transferCalls = 0;
  const holderClient = { getChainId:async()=>4663, getCode:async()=>"0x1234", getBlock:async()=>({number:BigInt(3_000_000),hash,timestamp:BigInt(Math.floor(Date.now()/1000))}),
    getLogs:async({fromBlock}:{fromBlock:bigint})=>{ transferCalls++; return fromBlock===BigInt(0) ? [{removed:false,blockNumber:BigInt(1),args:{from:zeroAddress,to:address(3001)}}] : []; },
    multicall:async({contracts}:{contracts:Array<{args:string[]}>})=>contracts.map((call)=>({status:"success",result:call.args[0]===address(3001)?BigInt(10):BigInt(0)})),
    readContract:async()=>supply } as unknown as PublicClient;
  await t.test("bounded holder scan resumes from0 history and publishes only after balances sum to supply", async () => {
    const partial = await refreshPriorityHolders(4663,address(1001),{client:holderClient,maxLogRequests:1});
    assert.equal(partial.complete,false); assert.equal(partial.holders,null); assert.equal((await readTokenMarket(4663,address(1001)))?.holders.value,null);
    const complete = await refreshPriorityHolders(4663,address(1001),{client:holderClient,maxLogRequests:1});
    assert.equal(complete.complete,true); assert.equal(complete.holders,1); assert.equal(transferCalls,2);
    assert.equal((await readTokenMarket(4663,address(1001)))?.holders.value,1);
    const reused = await refreshPriorityHolders(4663,address(1001),{client:holderClient,maxLogRequests:1});
    assert.equal(reused.logRequests,0); assert.equal(transferCalls,2);
  });
  await t.test("verified Alchemy ranges can contain over2k logs without discarding complete coverage", async () => {
    const previous = process.env.RPC_LOG_URL_4663; process.env.RPC_LOG_URL_4663="https://robinhood-mainnet.g.alchemy.com/v2/fixture-only";
    const many = { ...holderClient,getLogs:async({fromBlock}:{fromBlock:bigint})=>fromBlock===BigInt(0)
      ? Array.from({length:5000},()=>({removed:false,blockNumber:BigInt(1),args:{from:zeroAddress,to:address(3001)}})) : [] } as unknown as PublicClient;
    try {
      supply=BigInt(10);
      const partial = await refreshPriorityHolders(4663,address(9991),{client:many,maxLogRequests:1});
      assert.equal(partial.nextBlock,"2000000");
      const complete = await refreshPriorityHolders(4663,address(9991),{client:many,maxLogRequests:1});
      assert.equal(complete.holders,1); assert.equal(complete.complete,true);
    } finally { if(previous===undefined)delete process.env.RPC_LOG_URL_4663;else process.env.RPC_LOG_URL_4663=previous; }
  });
  await t.test("holder resumes reuse a bounded range hint and reject malformed or oversized hints", async () => {
    for (const [id,hint,expected] of [[9992,"1024","1024"],[9993,"0","2000000"],[9994,"99999999","2000000"],[9995,"broken","2000000"]] as const) {
      await pool.query("insert into registry_token_observations(chain_id,address,holder_scan) values(4663,$1,$2)",
        [address(id),{head:"3000000",hash,asOf:new Date().toISOString(),nextBlock:"0",addresses:[],logs:0,range:hint}]);
      const result = await refreshPriorityHolders(4663,address(id),{client:holderClient,maxLogRequests:1});
      assert.equal(result.nextBlock,expected);
      if (id===9992) {
        const resumed = await refreshPriorityHolders(4663,address(id),{client:holderClient,maxLogRequests:1});
        assert.equal(resumed.nextBlock,"3072");
      }
    }
  });
  await t.test("incomplete token transfer history never publishes a plausible partial holder count", async () => {
    supply=BigInt(11);
    await assert.rejects(refreshPriorityHolders(4663,address(1002),{client:holderClient,maxLogRequests:4}),/do not sum/);
    assert.equal((await readTokenMarket(4663,address(1002)))?.holders.value,null);
    assert.match((await readTokenMarket(4663,address(1002)))?.holders.reason ?? "",/do not sum/);
  });
});
