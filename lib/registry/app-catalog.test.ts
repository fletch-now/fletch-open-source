import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { appStatus, appStatusLabel, changedCatalogFields, orderSizeClamped, type CatalogPair } from "./app-catalog-model";
if (process.env.FLETCH_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;

function pair(id = "frong"): CatalogPair {
  return { id, symbol: `${id.toUpperCase()}-USD`, display_only: true, tradability: "untradable",
    tradability_by_account_type: { individual: "untradable", ira_roth: "untradable" }, is_stablecoin: false,
    min_order_size: "1.0", max_order_size: "1.0000000000000000",
    asset_currency: { id: `asset-${id}`, code: id.toUpperCase(), name: id, display_only: true }, quote_currency: { code: "USD" } };
}

function source(pairs: CatalogPair[]): typeof fetch {
  return (async function response() { return Response.json({ results: pairs, next: null }); }) as typeof fetch;
}

test("catalog status uses explicit fields; clamp and account availability remain independent", function status() {
  const before = pair();
  assert.equal(appStatus([before]), "display_only");
  assert.equal(appStatus([{ ...before, max_order_size: "600000" }]), "display_only");
  assert.equal(orderSizeClamped(before.max_order_size), true);
  assert.equal(orderSizeClamped("1.0001"), false);
  const after = { ...before, tradability_by_account_type: { ...before.tradability_by_account_type, ira_roth: "tradable" as const } };
  assert.deepEqual(changedCatalogFields(before, after), ["tradability_by_account_type"]);
  assert.equal(appStatus([after]), "unavailable");
  assert.equal(appStatus([]), "not_in_app");
});

test("catalog fails on schema/access/pagination changes and pins its observed client profile", async function access() {
  const { fetchAppCatalog } = await import("./app-catalog");
  let requests = 0;
  const pages = (async function response(url, init) {
    requests++;
    assert.equal((init?.headers as Record<string, string>)["user-agent"], "curl/8.7.1");
    return Response.json({ results: [pair(String(requests))], next: requests === 1 ? `${url}?cursor=2` : null });
  }) as typeof fetch;
  assert.equal((await fetchAppCatalog(pages)).length, 2);
  await assert.rejects(fetchAppCatalog(async () => new Response("denied", { status: 403 })), /HTTP 403/);
  await assert.rejects(fetchAppCatalog(async () => Response.json({ results: [{ symbol: "FRONG" }], next: null })), /schema changed/);
  await assert.rejects(fetchAppCatalog(async () => Response.json({ results: [pair()], next: "https://elsewhere.example/currency_pairs/" })), /outside/);
  await assert.rejects(fetchAppCatalog(source([pair(), pair()])), /repeats/);
});

test("catalog commits observations and diffs atomically; a replay reaches the signed webhook once", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function integration(t) {
  const { syncAppCatalog, readAppCatalog, statusForSymbol } = await import("./app-catalog");
  const { db, close } = await import("@/lib/db");
  const { user, watchers, authorityEvents, robinhoodAppPairs, robinhoodAppSync, watcherDeliveries } = await import("@/lib/db/schema");
  const { createWatcher } = await import("@/lib/watch/create");
  const { matchAuthorityEvents } = await import("@/lib/watch/authority");
  const { createWebhookEndpoint, signWebhookBody } = await import("@/lib/watch/webhooks");
  const { deliverOnce } = await import("@/lib/watch/deliver");
  const owner = randomUUID();
  const chainId = 777359;
  const bodies: Array<{ body: string; signature: string }> = [];
  const server = createServer(async function receive(request, response) {
    let body = "";
    for await (const chunk of request) body += chunk;
    bodies.push({ body, signature: String(request.headers["x-fletch-signature"]) });
    response.writeHead(200).end("accepted");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async function releaseResources() {
    try {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    } finally {
      await close();
    }
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.env.TELEGRAM_TOKEN_KEY = "controlled-listing-fixture";
  let ownsCatalog = false;
  try {
    assert.equal((await db.select().from(robinhoodAppPairs)).length, 0, "run in an isolated test database");
    ownsCatalog = true;
    await db.insert(user).values({ id: owner });
    const endpoint = await createWebhookEndpoint(owner, { url: `http://127.0.0.1:${address.port}/listing-replay` });
    const watcher = await createWatcher(owner, { kind: "listing_event", webhookId: endpoint.id });
    await db.update(watchers).set({ chainId }).where(eq(watchers.id, watcher.id));
    const initial = [pair(), pair("cashcat"), pair("pons"), pair("juggernaut"), pair("fifth")];
    assert.equal((await syncAppCatalog(chainId, source(initial))).detail?.events, 5);
    await matchAuthorityEvents(chainId);
    assert.equal((await db.select().from(watcherDeliveries).where(eq(watcherDeliveries.watcherId, watcher.id))).length, 0, "baseline is not a new launch alert");
    assert.equal((await syncAppCatalog(chainId, source(initial))).detail?.events, 0);
    const changed = initial.map((entry) => entry.id === "frong" ? { ...entry, display_only: false, tradability: "tradable" as const, asset_currency: { ...entry.asset_currency, display_only: false }, max_order_size: "900000", tradability_by_account_type: { individual: "tradable" as const, ira_roth: "untradable" as const } } : entry);
    assert.equal((await syncAppCatalog(chainId, source(changed))).detail?.events, 1);
    await matchAuthorityEvents(chainId);
    await matchAuthorityEvents(chainId);
    await deliverOnce();
    assert.equal(bodies.length, 1);
    const envelope = JSON.parse(bodies[0].body);
    const timestamp = Number(bodies[0].signature.split(",")[0].slice(2));
    assert.equal(bodies[0].signature, signWebhookBody(endpoint.secret, bodies[0].body, timestamp));
    const [delivery] = await db.select().from(watcherDeliveries).where(eq(watcherDeliveries.watcherId, watcher.id));
    assert.equal(delivery.status, "sent");
    assert.equal(envelope.payload.eventKind, "listing.changed");
    assert.equal(statusForSymbol(await readAppCatalog(), "FRONG").status, "tradable");
    await assert.rejects(syncAppCatalog(chainId, source([pair()])), /lost more than 20%/);
    assert.equal((await readAppCatalog()).pairs.length, 5);
    assert.match((await readAppCatalog()).error!, /20%/);
    assert.equal((await syncAppCatalog(chainId, source(changed.slice(0, 4)))).detail?.events, 1);
    const events = await db.select().from(authorityEvents).where(eq(authorityEvents.chainId, chainId));
    assert.equal(events.filter((event) => event.kind === "listing.removed").length, 1);
    assert.ok(events.every((event) => event.occurredAt.getTime() === event.observedAt.getTime()));
    console.log(JSON.stringify({ replay: true, deliveryId: delivery.id, status: delivery.status, eventKind: "listing.changed", signatureVerified: true, destination: "controlled local HTTP receiver", body: envelope }));
  } finally {
    await db.delete(user).where(eq(user.id, owner));
    await db.delete(authorityEvents).where(eq(authorityEvents.chainId, chainId));
    if (ownsCatalog) {
      await db.delete(robinhoodAppPairs);
      await db.delete(robinhoodAppSync);
    }
  }
});


test("NVDA Stock Token membership is outside the crypto source scope, including ticker collisions", async function stockScope() {
  const { statusForSymbol } = await import("./app-catalog");
  const reading = { source: "https://nummus.robinhood.com/currency_pairs/", observedAt: "2026-09-13T20:00:00.000Z", ageSeconds: 10, stale: false, error: null, pairs: [pair("frong")] };
  const stock = statusForSymbol(reading, "NVDA", "stock_token");
  assert.equal(stock.status, "not_covered");
  assert.equal(stock.scope, "crypto_currency_pairs");
  assert.equal(stock.match, "none");
  assert.deepEqual(stock.pairs, []);
  assert.equal(stock.observedAt, reading.observedAt);
  assert.equal(statusForSymbol({ ...reading, pairs: [pair("nvda")] }, "NVDA", "stock_token").status, "not_covered");
  assert.equal(statusForSymbol(reading, "NVDA").status, "not_in_app", "legacy field means crypto ticker absence only");
  assert.match(appStatusLabel("not_in_app"), /crypto catalog/);
  assert.match(stock.reason, /Stock Token list/);
  assert.equal(statusForSymbol(reading, null).status, "unavailable");
  for (const symbol of ["FRONG", "JUGGERNAUT", "PONS", "CASHCAT"]) {
    const status = statusForSymbol({ ...reading, pairs: [pair(symbol.toLowerCase())] }, symbol);
    assert.equal(status.status, "display_only");
    assert.equal(status.match, "ticker_only");
    assert.match(status.reason, /does not verify/);
  }
  const failed = statusForSymbol({ ...reading, stale: true, error: "Source failed" }, "FRONG");
  assert.equal(failed.stale, true);
  assert.equal(failed.error, "Source failed");
  assert.equal(failed.status, "display_only", "recorded source fields survive transport failure");
});
