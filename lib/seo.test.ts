import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { sitemapIndex, siteEntries, urlset } from "./sitemaps";
import { INDEXABLE_TOKENS_SQL } from "./registry/seo";
import { ListingInput } from "./apps/validation";
import { suggestListingSlug, validListingSlug } from "./apps/slug";
import { GET as skill } from "@/app/skill.md/route";
import { integrationGuide } from "./api/llm-reference";

test("sitemaps shard at 10,000 and keep root scope, canonical URLs and honest modification dates", () => {
  const index = sitemapIndex(10001, 20001);
  assert.equal((index.match(/<sitemap>/g) ?? []).length, 6);
  assert.match(index, /\/sitemap-apps-1\.xml/);
  assert.match(index, /\/sitemap-tokens-2\.xml/);
  assert.doesNotMatch(index, /<lastmod>/);
  const document = urlset([{ path: "/published/a&b", updatedAt: new Date("2026-09-15T08:00:00Z"), image: "/published/a&b/opengraph-image" }, { path: "/registry/markets/0x123" }]);
  assert.match(document, /a&amp;b/);
  assert.equal((document.match(/<lastmod>/g) ?? []).length, 1);
  assert.equal(new Set(siteEntries().map((row) => row.path)).size, siteEntries().length);
  assert.ok(siteEntries().every((row) => !/^\/(dashboard|admin|trafalgar|api)(\/|$)/.test(row.path)));
});

test("listing slugs reject path syntax, reserved hosts and invisible characters", () => {
  for (const slug of ["../admin", "a/b", "Hello", "a--b", "-hello", "hello-", "aa", "forge-1234", "a%20b", "abc\u200b", "x".repeat(61)]) assert.equal(validListingSlug(slug), false, slug);
  assert.equal(suggestListingSlug("ETH Raffle!"), "eth-raffle");
  assert.equal(suggestListingSlug("Café Counter"), "cafe-counter");
  const field = ListingInput.shape.slug;
  assert.equal(field.safeParse("eth-raffle").success, true);
  assert.equal(field.safeParse("../admin").success, false);
});

test("agent skill revalidates by content and explains current routes and recovery boundaries", async () => {
  const response = skill(new Request("https://fletch.now/skill.md"));
  const etag = response.headers.get("etag")!;
  const cached = skill(new Request("https://fletch.now/skill.md", { headers: { "if-none-match": `W/${etag}` } }));
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), "");
  assert.equal(skill(new Request("https://fletch.now/skill.md", { headers: { "if-none-match": '"older"' } })).status, 200);
  const guide = integrationGuide();
  for (const term of ["25 read tools", "token_discoveries", "/registry/markets/{address}", "complete original conversation", "app.slug", "## Agent workflow"]) assert.ok(guide.includes(term), term);
});

test("token sitemap excludes hidden, unread and wrong-chain identities and deduplicates issuer assets", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async (t) => {
  const db = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, max: 1 });
  const schema = `seo_${randomUUID().replaceAll("-", "")}`;
  t.after(async () => { await db.query(`drop schema if exists ${schema} cascade`); await db.end(); });
  await db.query(`create schema ${schema}; set search_path to ${schema},public;
    create table dex_tokens(chain_id integer,address text,hidden boolean default false,bytecode_present boolean default true,checked_at timestamp default now(),error text,symbol text default 'TEST',name text default 'Token',decimals integer default 18);
    create table registry_assets(chain_id integer,address text,status text);`);
  await db.query(`insert into dex_tokens(chain_id,address,hidden,bytecode_present,checked_at) values
    (4663,'community',false,true,now()),(4663,'listed',false,true,now()),(4663,'hidden',true,true,now()),
    (4663,'unread',false,true,null),(4663,'no-code',false,false,now()),(46630,'testnet',false,true,now());
    insert into registry_assets values (4663,'listed','active'),(4663,'issuer','active'),(4663,'hidden','active'),(4663,'old','inactive');`);
  assert.deepEqual((await db.query(`select address from (${INDEXABLE_TOKENS_SQL}) records order by address`, [4663])).rows.map((row) => row.address), ["community", "issuer", "listed"]);
});
