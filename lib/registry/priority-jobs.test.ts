import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, erc20Abi, parseAbi, zeroAddress } from "viem";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const hash = `0x${"ab".repeat(32)}` as `0x${string}`;
test("priority jobs bound metadata work, resolve named dominant groups and sample only current canonical prices", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function (t) {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, max: 1 });
  const namespace = `priority_jobs_${randomUUID().replaceAll("-", "")}`;
  const previousUrl = process.env.DATABASE_URL;
  const previousRpc = process.env.RPC_URL_4663;
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace}`);
  let close: (() => Promise<void>) | undefined;
  try {
    await admin.query(`create schema ${namespace}`);
    for (const table of ["dex_tokens", "dex_pools", "dex_price_samples", "rate_counters", "registry_assets"]) {
      await admin.query(`create table ${namespace}.${table} (like public.${table} including all)`);
    }
    process.env.DATABASE_URL = url.toString();
    const store = await import("@/lib/db"); close = store.close;
    const { pool } = store;
    for (const migration of ["0055_registry_priority.sql", "0058_registry_quote_observation.sql"]) await pool.query(await readFile(`drizzle/${migration}`, "utf8"));
    const jobs = await import("./priority-jobs");
    t.mock.method(console, "log", () => {});
    const now = new Date().getTime();
    let clock = now;
    t.mock.method(Date, "now", () => { clock += 5000; return clock; }); // Drain the existing pacing lane without wall-clock sleeps.
    process.env.RPC_URL_4663 = "http://127.0.0.1:1/priority-fixture";
    const seenMetadata: string[] = [];
    const holderTargets: string[] = [];
    let holderMode = false;
    let failBurn = false;
    let supplyMode = false;
    let rpcCalls = 0;
    const multicallAbi = parseAbi(["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)"]);
    const transferAbi = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
    function answer(data: `0x${string}`): `0x${string}` {
      const call = decodeFunctionData({ abi: erc20Abi, data });
      const result = call.functionName === "name" ? "Fixture" : call.functionName === "symbol" ? "FIXTURE" : call.functionName === "decimals" ? 18 :
        (holderMode || supplyMode) && (call.functionName === "totalSupply" || (call.functionName === "balanceOf" && call.args[0].toLowerCase() !== zeroAddress)) ? BigInt(5) : BigInt(0);
      return encodeFunctionResult({ abi: erc20Abi, functionName: call.functionName, result: result as never });
    }
    t.mock.method(globalThis, "fetch", async (input: unknown, init: RequestInit) => {
      assert.equal(String(input), process.env.RPC_URL_4663);
      const request = JSON.parse(String(init.body));
      rpcCalls++;
      let result: unknown;
      if (request.method === "eth_chainId") result = `0x${(4663).toString(16)}`;
      else if (request.method === "eth_getBlockByNumber") result = { number: "0x64", hash, timestamp: `0x${Math.floor(now/1000).toString(16)}`, transactions: [] };
      else if (request.method === "eth_getCode") { if (!holderMode) seenMetadata.push(request.params[0].toLowerCase()); result = "0x1234"; }
      else if (request.method === "eth_getLogs") {
        const token = request.params[0].address;
        holderTargets.push(token.toLowerCase());
        result = [{ address: token, blockNumber: "0x32", blockHash: hash, transactionHash: hash, transactionIndex: "0x0", logIndex: "0x0", removed: false,
          topics: encodeEventTopics({ abi: transferAbi, eventName: "Transfer", args: { from: zeroAddress, to: address(999) as `0x${string}` } }),
          data: encodeAbiParameters([{type:"uint256"}], [BigInt(5)]) }];
      } else if (request.method === "eth_call") {
        const data = request.params[0].data as `0x${string}`;
        if (data.startsWith("0x82ad56cb")) {
          const call = decodeFunctionData({ abi: multicallAbi, data });
          result = encodeFunctionResult({ abi: multicallAbi, functionName: "aggregate3", result: call.args[0].map((entry) => {
            const decoded = decodeFunctionData({ abi: erc20Abi, data: entry.callData });
            if (failBurn && entry.target.toLowerCase() === address(1) && decoded.functionName === "balanceOf") return { success: false, returnData: "0x" as const };
            return {success:true,returnData:answer(entry.callData)};
          }) });
        } else result = answer(data);
      } else throw new Error(`Unexpected fixture method ${request.method}`);
      return Response.json({jsonrpc:"2.0",id:request.id,result});
    });
    async function member(n: number, role = "community", group = address(n), dominant: string | null = address(n), symbol = "OTHER") {
      await pool.query(`insert into registry_priority_tokens(chain_id,address,role,group_key,dominant_address,selection_reason,rank,selected_at)
        values(4663,$1,$2,$3,$4,'fixture',$5,now())`, [address(n), role, group, dominant, n]);
      await pool.query(`insert into dex_tokens(id,chain_id,address,symbol,name) values($1,4663,$2,$3,$3)`, [`fixture-${n}`, address(n), symbol]);
    }
    await t.test("metadata selection has a100-token ceiling, retry cooldown and missing/future source-time repair", async function () {
      for (let n = 1; n <= 105; n++) await member(n);
      await member(106, "alternative");
      await member(107); await member(108); await member(109);
      await pool.query(`insert into registry_token_observations(chain_id,address,metadata,metadata_attempted_at) values
        (4663,$1,jsonb_build_object('reason',null,'asOf',(now()+interval '2 days')::text),null),
        (4663,$2,jsonb_build_object('reason',null),null),
        (4663,$3,jsonb_build_object('reason',null,'asOf',now()::text),now()),
        (4663,$4,null,now()),
        (4663,$5,jsonb_build_object('reason','failed','asOf',(now()-interval '2 days')::text),now())`,
      [address(1), address(2), address(107), address(108), address(109)]);
      const first = await jobs.refreshPriorityTokenMetadata(4663);
      assert.equal(first.rows, 100);
      assert.equal(seenMetadata.length, 100);
      assert.ok(seenMetadata.includes(address(1)) && seenMetadata.includes(address(2)));
      assert.ok(!seenMetadata.includes(address(106)) && !seenMetadata.includes(address(107)) && !seenMetadata.includes(address(108)) && !seenMetadata.includes(address(109)));
      assert.equal((await jobs.refreshPriorityTokenMetadata(4663)).rows, 5);
      assert.equal((await jobs.refreshPriorityTokenMetadata(4663)).rows, 0);
    });
    await t.test("discovery reserves an oldest slot and ranks pinned holdings above virtual pool depth", async function () {
      for (let n = 1; n <= 5; n++) {
        await pool.query(`insert into dex_pools(id,chain_id,venue,pool_address,currency0,currency1,fee,tick_spacing,hooks,
          token_address,created_block,created_block_hash,tier,first_seen_at,depth_usd,state_checked_at)
          values($1,4663,'uniswap_v3',$1,$2,$3,3000,60,$3,$2,1,$4,$5,$6,$7,now())`,
        [address(8000+n), address(9000+n), zeroAddress, hash, n === 4 ? "quiet" : "active",
          // This case covers established pools. New discoveries have a separate
          // rotating lane, exercised in dex-token-counterparties.test.ts.
          new Date(now-(n === 4 ? 86_400_000 : 7_200_000)), n === 5 ? 999999999 : 0]);
        if (n <= 3) await pool.query(`insert into registry_priority_pools(chain_id,pool_id,address,method,depth_usd,source,observed_at,attempted_at,factory_created_block,factory_created_hash)
          values(4663,$1,$2,'v3_quote_holdings',$3,'Pinned holdings',now(),now(),1,$4)`, [address(8000+n), address(9000+n), n*100, hash]);
      }
      const { dueTokenReads } = await import("./authority/dex-token-queue");
      const selectionAt = new Date();
      const { tokenFairPosition } = await import("./authority/dex-token-schedule");
      const expected = [address(9003),address(9002),address(9001)];
      expected.splice(tokenFairPosition(selectionAt), 0, address(9004));
      assert.deepEqual(await dueTokenReads(4663, selectionAt, null, 4, true), expected);
      const failedAt = new Date();
      // Match Drizzle’s UTC timestamp writes: node-pg serializes Date in the workstation timezone.
      await pool.query(`insert into dex_tokens(id,chain_id,address,checked_at,error) values('failed-discovery',4663,$1,$2,'Not an ERC20')`, [address(9003), failedAt.toISOString()]);
      assert.ok(!(await dueTokenReads(4663,failedAt,null,12,true)).includes(address(9003)), "a failed contract retains its one-hour retry backoff");
      const retryAt = new Date(failedAt.getTime() + 60 * 60_000);
      assert.deepEqual(await dueTokenReads(4663,new Date(retryAt.getTime() - 1),[address(9003)],1,true), []);
      assert.deepEqual(await dueTokenReads(4663,retryAt,[address(9003)],1,true), [address(9003)]);
    });
    await t.test("supply refresh preserves identity timestamps and failed burn observations", async function () {
      const oldMetadata = (await pool.query("select metadata from registry_token_observations where address=$1", [address(1)])).rows[0].metadata;
      await pool.query(`update registry_token_observations set metadata=metadata || jsonb_build_object(
        'supplyAttemptedAt',(now()-interval '4 minutes')::text,
        'supply',metadata->'supply' || jsonb_build_object('asOf',(now()-interval '4 minutes')::text),
        'burn',metadata->'burn' || jsonb_build_object('asOf',(now()-interval '4 minutes')::text)) where address=$1`, [address(1)]);
      const before = (await pool.query("select metadata from registry_token_observations where address=$1", [address(1)])).rows[0].metadata;
      const bytecodeReads = seenMetadata.length;
      failBurn = true; supplyMode = true;
      const run = await jobs.refreshPriorityTokenSupply(4663);
      assert.equal(run.rows, 1);
      assert.equal(run.detail?.failed, 1);
      assert.match(run.error ?? "", /supply or burn reads failed/);
      assert.equal(seenMetadata.length, bytecodeReads, "dynamic refresh never repeats bytecode or identity reads");
      const after = (await pool.query("select metadata from registry_token_observations where address=$1", [address(1)])).rows[0].metadata;
      assert.equal(after.asOf, oldMetadata.asOf);
      assert.equal(after.name, oldMetadata.name);
      assert.equal(after.supply.value, "5");
      assert.equal(after.supply.blockHash, hash);
      assert.ok(after.supply.fetchedAt);
      assert.deepEqual(after.burn, before.burn, "failed burn calls retain the value and original source time");
      assert.ok(after.burnError);
      assert.equal((await jobs.refreshPriorityTokenSupply(4663)).rows, 0, "failed token retry has a persisted cooldown");
      const coverage = run.detail?.metricCoverage as { supply: { current: number }; burn: { failed: number } };
      assert.ok(coverage.supply.current > 0);
      assert.equal(coverage.burn.failed, 1);
      failBurn = false; supplyMode = false;
    });
    await pool.query("truncate registry_priority_tokens,registry_token_observations,dex_tokens");
    holderMode = true;
    await t.test("holder pages cover listed and community tokens with bounded retries, retained RPC proof and shared token locks", async function (holderTest) {
      await member(0, "community");
      await member(1, "alternative", address(1), address(2), "CASHCAT");
      await member(2, "community", address(1), address(2), "ALIAS");
      await member(3, "community", address(3), null, "PIPEDOG");
      await member(4, "community", address(4), address(4), "PONS");
      await member(5, "community", address(5), address(5), "OPAI");
      await member(6, "community");
      for (let n = 8; n <= 45; n++) await member(n, n % 2 === 0 ? "listed" : "community", address(n), address(n), ({42:"OPENAI",43:"syrupUSDG",44:"ANTH",45:"Squikies"} as Record<number,string>)[n] ?? "OTHER");
      const checkpoint = { head: "100", hash, nextBlock: "50", addresses: [address(999)], logs: 20 };
      await pool.query(`insert into registry_token_observations(chain_id,address,holders,holders_attempted_at,holder_scan) values
        (4663,$1,jsonb_build_object('value',77,'reason',null,'source','public explorer','asOf',(now()-interval '20 minutes')::text),now()-interval '16 minutes',$10),
        (4663,$2,jsonb_build_object('value',3,'reason',null,'asOf',(now()+interval '1 day')::text),now()-interval '16 minutes',null),
        (4663,$3,jsonb_build_object('value',0,'reason',null,'asOf',now()::text),null,null),
        (4663,$4,jsonb_build_object('value',8,'reason',null,'asOf',(now()-interval '2 hours')::text,'blockNumber','58738947','blockHash',$11::text),null,$10),
        (4663,$5,jsonb_build_object('value',6,'reason',null,'asOf',(now()-interval '1 hour')::text),null,null),
        (4663,$6,null,now(),null),
        (4663,$7,jsonb_build_object('value',9,'reason',null,'asOf',(now()-interval '2 days')::text),now(),null),
        (4663,$8,jsonb_build_object('value',11,'reason',null,'asOf',(now()-interval '7 hours')::text),null,null),
        (4663,$9,jsonb_build_object('value',12,'reason',null,'asOf',(now()-interval '25 hours')::text,'blockNumber','100','blockHash',$11::text),null,null)`,
      [address(2), address(3), address(4), address(5), address(6), address(8), address(9), address(11), address(12), checkpoint, hash]);
      const proofBefore = (await pool.query("select holders,holder_scan from registry_token_observations where address=$1", [address(5)])).rows[0];
      const oldSnapshot = (await pool.query("select holders,holder_scan from registry_token_observations where address=$1", [address(2)])).rows[0];
      const requests: string[] = [];
      holderTest.mock.method(globalThis, "fetch", async function explorer(input: unknown) {
        const url = new URL(String(input));
        assert.equal(url.origin, "https://www.robinscan.net");
        const token = url.pathname.split("/").at(-1)!;
        requests.push(token);
        if (token === address(2)) return new Response("Unavailable", { status: 503, headers: { "content-type": "text/html" } });
        return new Response(`<p>Chain ID4663</p><h1>Fixture</h1><div>Contract</div><div><a href="/address/${token}">${token}</a></div><div>Holders</div><div>42</div>`, { headers: { "content-type": "text/html" } });
      });
      const first = await jobs.refreshPriorityHolderSnapshot(4663);
      assert.equal(first.rows, 28);
      assert.equal(first.detail?.notApplicable, 1);
      assert.equal(requests.length, 29);
      assert.deepEqual(new Set(requests.slice(0,5)), new Set([address(3),address(42),address(43),address(44),address(45)]), "all named missing groups lead the same-cohort listed rows");
      assert.ok(requests.includes(address(2)), "an eligible major with a prior reading must not wait behind the missing-holder backlog");
      assert.ok(requests.includes(address(10)), "listed priority tokens receive holder work");
      assert.equal((await jobs.refreshPriorityHolderSnapshot(4663)).rows, 9);
      assert.equal(requests.length, 38);
      assert.ok(requests.includes(address(3)), "future source time is invalid and gets repaired");
      for (const n of [0, 1, 4, 5, 6, 8, 9]) assert.ok(!requests.includes(address(n)), `excluded or fresh/cooling token ${n} was requested`);
      for (const n of [2, 3, 11, 12]) assert.ok(requests.includes(address(n)));
      assert.deepEqual((await pool.query("select holders,holder_scan from registry_token_observations where address=$1", [address(5)])).rows[0], proofBefore);
      assert.deepEqual((await pool.query("select holders,holder_scan from registry_token_observations where address=$1", [address(2)])).rows[0], oldSnapshot, "failed public fetch retains the prior count and native checkpoint");
      assert.equal((await jobs.refreshPriorityHolderSnapshot(4663)).rows, 0, "attempt cooldown prevents immediate retry, including the failed page");
      const repaired = (await pool.query("select holders from registry_token_observations where address=$1", [address(3)])).rows[0].holders;
      assert.equal(repaired.value, 42);
      assert.equal(repaired.blockNumber, null);
      assert.ok(Date.parse(repaired.asOf) <= new Date().getTime());
      const native = (await pool.query("select holders from registry_token_observations where address=$1", [address(0)])).rows[0].holders;
      assert.match(native.reason, /native ETH, not an ERC-20 token/);
      assert.equal(native.value, null);
      assert.deepEqual(holderTargets, [], "the recurring job must not start native Transfer scans");
      await member(46, "listed");
      const lock = await pool.connect();
      try {
        await lock.query("select pg_advisory_lock(hashtextextended($1,55))", [`holders:4663:${address(46)}`]);
        const before = requests.length;
        const locked = await jobs.refreshPriorityHolderSnapshot(4663);
        assert.equal(locked.rows, 0);
        assert.equal(locked.detail?.skipped, 1);
        assert.equal(requests.length, before, "native scanner's lock blocks the public fetch");
      } finally {
        await lock.query("select pg_advisory_unlock(hashtextextended($1,55))", [`holders:4663:${address(46)}`]);
        lock.release();
      }
      assert.equal((await jobs.refreshPriorityHolderSnapshot(4663)).rows, 1);
    });
    await t.test("the persistent daily budget denies a metadata request before transport", async function () {
      const { WATCH_LIMITS } = await import("@/lib/watch/types");
      await member(7);
      await pool.query("update rate_counters set count=$1 where bucket='rpc:day'", [WATCH_LIMITS.rpcCallsPerDay]);
      const before = rpcCalls;
      await assert.rejects(jobs.refreshPriorityTokenMetadata(4663), /Daily RPC budget/);
      assert.equal(rpcCalls, before);
      await pool.query("update rate_counters set count=0 where bucket='rpc:day'");
    });
    await t.test("price sampling rejects expired or failed quote inputs independently of fresh pool state", async function () {
      const sampledAt = new Date();
      const quote = { value: 1, method: "fixed_notional_usdg", sourceAt: null,
        fetchedAt: new Date(sampledAt.getTime()-1000).toISOString(), expiresAt: new Date(sampledAt.getTime()+180_000).toISOString(), reason: null };
      const quoteCases = [
        { ...quote, expiresAt: new Date(sampledAt.getTime()-1000).toISOString() },
        { ...quote, reason: "Quote read failed" },
        { ...quote, fetchedAt: new Date(sampledAt.getTime()+60_000).toISOString() },
        { ...quote, sourceAt: new Date(sampledAt.getTime()+60_000).toISOString() },
        { ...quote, method: "quote_token_usd_feed" },
        { ...quote, value: null },
        quote,
        quote,
      ];
      for (let n = 1; n <= 15; n++) {
        await pool.query(`insert into dex_pools(id,chain_id,venue,pool_address,currency0,currency1,fee,tick_spacing,hooks,created_block,created_block_hash)
          values($1,4663,'uniswap_v3',$1,$2,$3,3000,60,$2,10,$4)`, [address(2000+n), zeroAddress, address(n), hash]);
        await pool.query(`insert into registry_priority_pools(chain_id,pool_id,address,selected,method,depth_usd,price_usd,source,reason,observed_at,attempted_at,factory_created_block,factory_created_hash,quote_observation)
          values(4663,$1,$2,$3,'v3_quote_holdings',100,2,'fixture',$4,$5,now(),$6,$7,$8)`,
        [address(2000+n), address(n), n !== 2, n === 3 ? "failed" : null,
          new Date(sampledAt.getTime() + (n === 4 ? -16*60_000 : n === 5 ? 60_000 : -1000)), n === 6 ? 11 : 10, n === 7 ? "changed" : hash,
          n >= 8 ? quoteCases[n-8] : null]);
        await pool.query(`update dex_pools p set state_checked_at=pp.observed_at at time zone 'UTC',
          price_usd=case when p.id=$2 then 9 else pp.price_usd end,depth_usd=pp.depth_usd
          from registry_priority_pools pp where pp.pool_id=p.id and p.id=$1`, [address(2000+n), address(2015)]);
      }
      assert.equal((await jobs.samplePriorityPrices(4663)).rows, 2, "sampling requires current quote inputs and an exact mirrored snapshot");
      assert.equal((await jobs.samplePriorityPrices(4663)).rows, 0, "repeated sampling is idempotent");
      assert.deepEqual((await pool.query("select pool_id,price_usd from dex_price_samples order by pool_id")).rows,
        [{ pool_id: address(2001), price_usd: "2" }, { pool_id: address(2014), price_usd: "2" }]);
      await pool.query(`update registry_priority_pools set observed_at=now(),quote_observation=$2 where pool_id=$1`, [address(2014), quoteCases[0]]);
      await pool.query(`update dex_pools p set state_checked_at=pp.observed_at at time zone 'UTC'
        from registry_priority_pools pp where pp.pool_id=p.id and p.id=$1`, [address(2014)]);
      assert.equal((await jobs.samplePriorityPrices(4663)).rows, 0, "a newer pool state cannot create history after its quote expires");
      assert.equal((await pool.query("select count(*)::int as n from dex_price_samples")).rows[0].n, 2, "prior valid history remains intact");
    });
  } finally {
    t.mock.restoreAll();
    if (close) await close();
    process.env.DATABASE_URL = previousUrl;
    process.env.RPC_URL_4663 = previousRpc;
    await admin.query(`drop schema if exists ${namespace} cascade`);
    await admin.end();
  }
});
