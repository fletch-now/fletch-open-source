import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeSearchLike, matchesContractText, normalizeContractQuery, parseContractQuery } from "./contract-search-query";

const ADDRESS = "0x111122223333444455556666777788889999aaaa";
const POOL_ID = `0x${"ab".repeat(32)}`;

test("search normalization accepts ticker prefixes, full-width text and whitespace", function normalization() {
  assert.equal(normalizeContractQuery("  ＄ＮＶＤＡ  "), "NVDA");
  assert.equal(parseContractQuery("  $NvDa  ").text, "nvda");
  assert.deepEqual(parseContractQuery(" Green\n Hood\tFrog ").terms, ["green", "hood", "frog"]);
  assert.equal(matchesContractText(["FRONG", "Green Hood Frog"], "frog green"), true);
  assert.equal(matchesContractText(["FRONG", "Green Hood Frog"], "frog purple"), false);
});

test("contract and pool URLs resolve only complete recognized path identifiers", function urls() {
  for (const url of [
    `https://fletch.now/registry/token/${ADDRESS}?tab=holders#top`,
    `https://explorer.example/address/${ADDRESS}/transactions`,
    `https://explorer.example/token/${ADDRESS.toUpperCase()}`,
  ]) {
    const parsed = parseContractQuery(url);
    assert.equal(parsed.mode, "address");
    assert.equal(parsed.text, ADDRESS);
  }
  assert.equal(parseContractQuery(`https://explorer.example/pool/${POOL_ID}`).mode, "pool");
  for (const value of [`https://explorer.example/token/${ADDRESS}0`, "https://[invalid", "https://example.com/docs/registry"]) {
    assert.equal(normalizeContractQuery(value), value);
    assert.equal(parseContractQuery(value).mode, "text");
  }
});

test("chain-qualified addresses and pool identifiers retain their distinct modes", function addresses() {
  for (const value of [ADDRESS, ADDRESS.toUpperCase(), `4663:${ADDRESS}`, `eip155:4663:${ADDRESS}`]) {
    const parsed = parseContractQuery(value);
    assert.equal(parsed.mode, "address");
    assert.equal(parsed.text, ADDRESS);
  }
  assert.equal(parseContractQuery(POOL_ID).mode, "pool");
  assert.equal(parseContractQuery(`eip155:46630:${ADDRESS}`).mode, "text");
  assert.equal(parseContractQuery("0x111").mode, "text");
  assert.equal(parseContractQuery(`${ADDRESS}f`).mode, "text");
  assert.equal(parseContractQuery("uS67066g1040").mode, "isin");
});

test("shortened addresses match prefix and suffix on the same recorded address", function shortenedAddresses() {
  for (const value of ["0x1111…aaaa", "0x1111...aaaa", "0x11112222"]) {
    assert.equal(parseContractQuery(value).mode, "fragment");
    assert.equal(matchesContractText([ADDRESS], value), true);
    assert.equal(matchesContractText([`0x2222${ADDRESS.slice(6)}`], value), false);
  }
  const parsed = parseContractQuery("0x1111…AAAA");
  assert.equal(parsed.prefix, "0x1111");
  assert.equal(parsed.suffix, "aaaa");
  assert.equal(matchesContractText(["0x11112222", "0x2222aaaa"], "0x1111…aaaa"), false);
});

test("percent, underscore and backslash remain literal ticker characters", function literals() {
  for (const [value, other] of [["P%Q", "PZQ"], ["UNDER_SCORE", "UNDERXSCORE"], ["A\\B", "AXB"]]) {
    assert.deepEqual(parseContractQuery(value).terms, [value.toLowerCase()]);
    assert.equal(matchesContractText([value], value), true);
    assert.equal(matchesContractText([other], value), false);
  }
  assert.equal(escapeSearchLike("P%Q_UNDER\\PATH"), "P\\%Q\\_UNDER\\\\PATH");
});

test("punctuation-only searches do not match every catalog entry", function punctuation() {
  const token = [null, "NVDA", "NVIDIA Corporation", undefined];
  for (const value of ["---", "...", "!?", "%", "_", "\\", "%%__"]) {
    assert.equal(matchesContractText(token, value), false);
  }
  assert.equal(matchesContractText(token, ""), true, "an empty filter keeps the unfiltered view");
  assert.equal(matchesContractText(["%"], "%"), true, "an actual percent symbol is still literal data");
  assert.equal(matchesContractText([], "!?"), false);
});
