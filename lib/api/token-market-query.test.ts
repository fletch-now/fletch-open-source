import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenMarketParams, tokenMarketQuery } from "./token-market-query";

test("token market queries retain explicit volume ordering and bounded pagination", function () {
  assert.deepEqual(tokenMarketQuery(new URLSearchParams()), { page: 1, pageSize: 25, sort: "volume", kind: "all", query: "" });
  assert.deepEqual(tokenMarketQuery(new URLSearchParams("q=CASHCAT&page=2&pageSize=50&trust=community")), {
    page: 2, pageSize: 50, sort: "volume", kind: "all", query: "CASHCAT", trust: "community",
  });
  for (const invalid of ["page=0", "page=-2", "page=1.5", "page=1e5", "page=1000000", "pageSize=1000", "sort=depth", "trust=official", "kind=fakes", "q=" + "x".repeat(129)]) {
    assert.throws(() => tokenMarketQuery(new URLSearchParams(invalid)), Error, invalid);
  }
});

test("market search accepts copied addresses and resets discovery pagination independently", function () {
  const address = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";
  const params = new URLSearchParams({ q: `https://explorer.example/address/${address}?tab=token`, page: "2", searchPage: "3" });
  const query = tokenMarketQuery(params);
  assert.equal(query.query, address);
  assert.equal(query.page, 2);
  assert.equal(query.searchPage, 3);
  assert.equal(tokenMarketParams(query).get("searchPage"), "3");
  for (const invalid of ["searchPage=0", "searchPage=100000", "searchPage=2&searchPage=3", "searchPage=1.5"]) {
    assert.throws(() => tokenMarketQuery(new URLSearchParams(invalid)));
  }
});
