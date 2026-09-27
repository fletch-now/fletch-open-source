import assert from "node:assert/strict";
import { test } from "node:test";
import { collidesWith, foldTicker, trustLevelFor, trustVerdict, type TokenFacts, type Verified } from "./trust-rules";

const VERIFIED: Verified[] = [
  { symbol: "TSLA", name: "Tesla • Robinhood Token", address: "0xaaa" },
  { symbol: "ON", name: "ON Semiconductor • Robinhood Token", address: "0xbbb" },
];

function facts(over: Partial<TokenFacts> = {}): TokenFacts {
  return { inRegistry: false, registryConfirmed: false, symbol: "MEME", name: "Meme Coin", decimals: 18, bytecodePresent: true, ...over };
}

test("folding drops the ticker dollar, separators and case", function () {
  assert.equal(foldTicker("$tsla"), "TSIA");
  assert.equal(foldTicker("T-S-L-A"), "TSIA");
  assert.equal(foldTicker(" Tesla Token "), "TESIATOKEN");
  assert.equal(foldTicker(null), "");
});

test("folding maps Cyrillic and Greek homoglyphs onto Latin", function () {
  assert.equal(foldTicker("ТЅLА"), foldTicker("TSLA"));
  assert.equal(foldTicker("ΤЅLΑ"), foldTicker("TSLA"));
  assert.equal(foldTicker("СOIN"), "COIN");
});

test("folding maps the digit-letter twins", function () {
  assert.equal(foldTicker("0N"), foldTicker("ON"));
  assert.equal(foldTicker("A1RB"), "AIRB");
  assert.equal(foldTicker("TSIA"), foldTicker("TSLA"));
  assert.equal(foldTicker("lI1"), "III");
});

test("folding removes invisible characters", function () {
  assert.equal(foldTicker("TS​LA"), foldTicker("TSLA"));
  assert.equal(foldTicker("TSLA﻿"), foldTicker("TSLA"));
});

test("a homoglyph ticker collides with the asset it imitates", function () {
  assert.deepEqual(collidesWith(facts({ symbol: "ТSLA", name: "Tesla" }), VERIFIED), VERIFIED[0]);
  assert.deepEqual(collidesWith(facts({ symbol: "0N", name: "Onsemi" }), VERIFIED), VERIFIED[1]);
});

test("a name collision counts even when the symbol does not", function () {
  assert.deepEqual(collidesWith(facts({ symbol: "XYZ", name: "Tesla • Robinhood Token" }), VERIFIED), VERIFIED[0]);
});

test("an unrelated token collides with nothing", function () {
  assert.equal(collidesWith(facts(), VERIFIED), null);
});

test("a listed token is never a lookalike of anything", function () {
  assert.equal(collidesWith(facts({ inRegistry: true, symbol: "TSLA" }), VERIFIED), null);
});

test("levels follow the registry first, then the collision, then what answered", function () {
  assert.equal(trustLevelFor(facts({ inRegistry: true, registryConfirmed: true }), null), "verified");
  assert.equal(trustLevelFor(facts({ inRegistry: true }), null), "listed");
  assert.equal(trustLevelFor(facts(), VERIFIED[0]), "lookalike");
  assert.equal(trustLevelFor(facts(), null), "community");
  assert.equal(trustLevelFor(facts({ symbol: null, name: null }), null), "unknown");
  assert.equal(trustLevelFor(facts({ bytecodePresent: false }), null), "unknown");
  assert.equal(trustLevelFor(facts({ bytecodePresent: null }), null), "unknown");
  assert.equal(trustLevelFor(facts({ decimals: null }), null), "unknown");
  assert.equal(trustLevelFor(facts({ symbol: null }), null), "unknown");
});

test("a lookalike verdict carries the address of the token it imitates", function () {
  const verdict = trustVerdict(facts({ symbol: "ТSLA" }), VERIFIED);
  assert.equal(verdict.level, "lookalike");
  assert.equal(verdict.impersonates?.address, "0xaaa");
  assert.match(verdict.detail, /0xaaa/);
});

test("only a Stock Token is called one; a verified bridged coin is a verified listing", function () {
  const stock = trustVerdict(facts({ inRegistry: true, registryConfirmed: true, assetType: "stock_token" }), VERIFIED);
  const bridged = trustVerdict(facts({ inRegistry: true, registryConfirmed: true, assetType: "bridged" }), VERIFIED);
  assert.equal(stock.label, "Verified Stock Token");
  assert.equal(bridged.label, "Verified listing");
});

test("registry and arbitrary-address verdicts share the same confirmed identity rule", async function () {
  const { registryTokenFacts } = await import("./trust-rules");
  const asset = { symbol: "cbBTC", name: "Bitcoin", decimals: 8, onchainSymbol: "cbBTC", onchainDecimals: 8, verifiedAt: new Date(), assetType: "bridged" };
  assert.equal(trustVerdict(registryTokenFacts(asset), []).level, "verified");
  assert.equal(trustVerdict(registryTokenFacts({ ...asset, verifiedAt: null }), []).level, "listed");
  assert.equal(trustVerdict(registryTokenFacts({ ...asset, onchainDecimals: 18 }), []).level, "listed");
  assert.equal(trustVerdict(registryTokenFacts({ ...asset, onchainSymbol: "FAKE" }), []).level, "listed");
});
