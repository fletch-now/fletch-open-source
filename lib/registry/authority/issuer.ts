// The issuer's paperwork. The EU legal hub lists every prospectus, supplement
// and Final Terms PDF; each is tracked by the CDN's ETag and Last-Modified,
// so two hundred documents are checked with HEAD requests and only a new or
// changed one is announced. A handful of pages whose words carry rules
// (restricted jurisdictions, corporate actions, upgrade notices) are kept as
// a hash of their text, so an edit becomes an event with the page named.

import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { issuerDocuments, issuerPages, registryAssets } from "@/lib/db/schema";
import { logEvent } from "@/lib/log";
import { ISSUER_LEGAL_HUB, ISSUER_PAGES } from "@/lib/registry/authority/constants";
import { emitEvents, type AuthorityEventInput } from "@/lib/registry/authority/events";
import type { RunOutcome } from "@/lib/registry/authority/runs";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const HEAD_PACE_MS = 200;

export type IssuerDocument = typeof issuerDocuments.$inferSelect;
export type IssuerPage = typeof issuerPages.$inferSelect;

interface Listed {
  url: string;
  title: string;
  kind: string;
  underlying: string | null;
}

function decodeEntities(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function kindOf(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("base prospectus")) {
    return "base_prospectus";
  }
  if (lower.includes("final terms")) {
    return "final_terms";
  }
  if (lower.includes("supplement")) {
    return "supplement";
  }
  if (lower.includes("notice") || lower.includes("amendment")) {
    return "notice";
  }
  return "other";
}

// "Final Terms for Tokenised Debt Securities linked to Tesla, Inc." names the
// underlying after "linked to".
function underlyingOf(title: string): string | null {
  const match = /linked to (.+)$/i.exec(title);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" }, signal: AbortSignal.timeout(30_000), redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${response.status} from ${url}`);
  }
  return response.text();
}

// The hub renders each document as a card: a span with the title, a span
// with the date, then a link whose only content is a download icon. The
// title is therefore the last text span before the link; the file name is
// the fallback when the markup changes.
function titleFromUrl(url: string): string {
  const file = url.split("/").pop()?.replace(/\.pdf$/i, "") ?? url;
  return file.replace(/^rhj_/, "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseHub(html: string): Listed[] {
  const listed = new Map<string, Listed>();
  const anchor = /<a\s[^>]*href="([^"]+\.pdf)"[^>]*>/gi;
  for (const match of html.matchAll(anchor)) {
    const url = match[1].startsWith("http") ? match[1] : new URL(match[1], ISSUER_LEGAL_HUB).toString();
    if (listed.has(url)) {
      continue;
    }
    const before = html.slice(Math.max(0, (match.index ?? 0) - 1200), match.index);
    const spans = [...before.matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((span) => decodeEntities(span[1]));
    const texts = spans.filter((span) => span.length > 3 && !/^\w{3} \d{1,2}, \d{4}/.test(span));
    const title = (texts[texts.length - 1] ?? titleFromUrl(url)).replace(/^RHJ\s+/i, "");
    listed.set(url, { url, title, kind: kindOf(title), underlying: underlyingOf(title) });
  }
  return [...listed.values()];
}

interface HeadFacts {
  etag: string | null;
  lastModified: Date | null;
  bytes: bigint | null;
  ok: boolean;
}

// Cloudflare serves the same file with a weak ETag one minute and a strong one
// the next; only a different hash, size or Last-Modified is a revision.
function etagHash(etag: string | null): string | null {
  return etag ? etag.replace(/^W\//i, "").replace(/"/g, "").trim() : null;
}

function documentChanged(previous: { etag: string | null; bytes: bigint | null; lastModified: Date | null }, facts: HeadFacts): boolean {
  const hashChanged = etagHash(previous.etag) !== null && etagHash(facts.etag) !== null && etagHash(previous.etag) !== etagHash(facts.etag);
  const sizeChanged = previous.bytes !== null && facts.bytes !== null && previous.bytes !== facts.bytes;
  const dateChanged = previous.lastModified !== null && facts.lastModified !== null && previous.lastModified.getTime() !== facts.lastModified.getTime();
  return hashChanged || sizeChanged || dateChanged;
}

async function headOf(url: string): Promise<HeadFacts> {
  await new Promise(function later(resolve) {
    setTimeout(resolve, HEAD_PACE_MS);
  });
  const response = await fetch(url, { method: "HEAD", headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
  const modified = response.headers.get("last-modified");
  const length = response.headers.get("content-length");
  return {
    etag: response.headers.get("etag"),
    lastModified: modified ? new Date(modified) : null,
    bytes: length && /^\d+$/.test(length) ? BigInt(length) : null,
    ok: response.ok,
  };
}

// A Final Terms title names a company; the registry names the token after
// the same company. The first word of each, when it is long enough to be
// distinctive and matches exactly one asset, ties the document to the token.
function firstWord(name: string): string {
  return name.split(/[\s,.•]+/)[0]?.toLowerCase() ?? "";
}

async function assetIndex(chainId: number): Promise<Map<string, string | null>> {
  const rows = await db.select({ id: registryAssets.id, name: registryAssets.name }).from(registryAssets).where(eq(registryAssets.chainId, chainId));
  const byWord = new Map<string, string | null>();
  for (const row of rows) {
    const word = firstWord(row.name);
    if (word.length < 3) {
      continue;
    }
    byWord.set(word, byWord.has(word) ? null : row.id);
  }
  return byWord;
}

export async function syncIssuerDocuments(chainId: number): Promise<RunOutcome> {
  const html = await fetchText(ISSUER_LEGAL_HUB);
  const listed = parseHub(html);
  if (listed.length === 0) {
    throw new Error("legal hub listed no documents");
  }
  const byWord = await assetIndex(chainId);
  const known = new Map((await db.select().from(issuerDocuments)).map((row) => [row.url, row]));
  const announcing = known.size > 0;
  const events: AuthorityEventInput[] = [];
  const now = new Date();
  let added = 0;
  let changed = 0;
  let headFailed = 0;
  for (const doc of listed) {
    const previous = known.get(doc.url);
    const facts = await headOf(doc.url).catch(function unavailable() {
      return { etag: null, lastModified: null, bytes: null, ok: false } as HeadFacts;
    });
    if (!facts.ok) {
      headFailed += 1;
    }
    const assetId = doc.underlying ? (byWord.get(firstWord(doc.underlying)) ?? null) : null;
    const isChanged = previous !== undefined && facts.ok && documentChanged(previous, facts);
    await db
      .insert(issuerDocuments)
      .values({ url: doc.url, title: doc.title, kind: doc.kind, underlying: doc.underlying, assetId, etag: facts.etag, lastModified: facts.lastModified, bytes: facts.bytes, lastSeenAt: now, changedAt: null })
      .onConflictDoUpdate({
        target: issuerDocuments.url,
        set: {
          title: doc.title,
          kind: doc.kind,
          underlying: doc.underlying,
          assetId,
          etag: facts.ok ? facts.etag : previous?.etag ?? null,
          lastModified: facts.ok ? facts.lastModified : previous?.lastModified ?? null,
          bytes: facts.ok ? facts.bytes : previous?.bytes ?? null,
          lastSeenAt: now,
          goneAt: null,
          changedAt: isChanged ? now : previous?.changedAt ?? null,
        },
      });
    if (!previous) {
      added += 1;
    }
    if (isChanged) {
      changed += 1;
    }
    if (announcing && (!previous || isChanged)) {
      events.push({
        chainId,
        kind: previous ? "issuer.document_changed" : "issuer.document_new",
        assetId,
        symbol: assetId ? (await symbolOf(assetId)) : null,
        key: doc.url,
        detail: { title: doc.title, kind: doc.kind, underlying: doc.underlying, url: doc.url, lastModified: facts.lastModified?.toISOString() ?? null, bytes: facts.bytes?.toString() ?? null },
        occurredAt: facts.lastModified ?? now,
      });
    }
  }
  const listedUrls = new Set(listed.map((doc) => doc.url));
  let gone = 0;
  for (const [url, row] of known) {
    if (!listedUrls.has(url) && row.goneAt === null) {
      await db.update(issuerDocuments).set({ goneAt: now }).where(eq(issuerDocuments.url, url));
      gone += 1;
      events.push({ chainId, kind: "issuer.document_gone", assetId: row.assetId, key: url, detail: { title: row.title, kind: row.kind, url }, occurredAt: now });
    }
  }
  await emitEvents(events);
  logEvent("registry", { event: "issuer-docs", listed: listed.length, added, changed, gone, headFailed });
  return { rows: listed.length, detail: { added, changed, gone, headFailed, mapped: listed.filter((doc) => doc.underlying && byWord.get(firstWord(doc.underlying))).length } };
}

async function symbolOf(assetId: string): Promise<string | null> {
  const rows = await db.select({ symbol: registryAssets.symbol }).from(registryAssets).where(eq(registryAssets.id, assetId)).limit(1);
  return rows[0]?.symbol ?? null;
}

// The page's words without markup, scripts or the site chrome that repeats
// on every page, so a hash changes only when the content does.
function pageText(html: string): { title: string | null; text: string } {
  const title = /<title>(.*?)<\/title>/i.exec(html)?.[1] ?? null;
  const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
  const text = decodeEntities(
    main
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
  return { title: title ? decodeEntities(title) : null, text };
}

export async function syncIssuerPages(chainId: number): Promise<RunOutcome> {
  const events: AuthorityEventInput[] = [];
  let changed = 0;
  let failed = 0;
  const now = new Date();
  for (const page of ISSUER_PAGES) {
    let html: string;
    try {
      html = await fetchText(page.url);
    } catch {
      failed += 1;
      continue;
    }
    const { title, text } = pageText(html);
    const sha256 = createHash("sha256").update(text).digest("hex");
    const previous = await db.select().from(issuerPages).where(eq(issuerPages.slug, page.slug)).limit(1);
    const before = previous[0];
    const isChanged = before !== undefined && before.sha256 !== sha256;
    await db
      .insert(issuerPages)
      .values({ slug: page.slug, url: page.url, title, sha256, excerpt: text.slice(0, 600), lastSeenAt: now })
      .onConflictDoUpdate({ target: issuerPages.slug, set: { url: page.url, title, sha256, excerpt: text.slice(0, 600), lastSeenAt: now, changedAt: isChanged ? now : before?.changedAt ?? null } });
    if (isChanged) {
      changed += 1;
      events.push({
        chainId,
        kind: page.slug === "chain-notices" ? "chain.notice_changed" : "issuer.page_changed",
        key: `${page.slug}:${sha256.slice(0, 12)}`,
        detail: { page: page.slug, url: page.url, title, previousSha256: before?.sha256 ?? null, sha256 },
        occurredAt: now,
      });
    }
  }
  if (failed === ISSUER_PAGES.length) {
    throw new Error("no issuer page could be fetched");
  }
  await emitEvents(events);
  return { rows: ISSUER_PAGES.length - failed, detail: { changed, failed } };
}

export async function issuerDocumentsAll(): Promise<IssuerDocument[]> {
  return db.select().from(issuerDocuments).orderBy(sql`case ${issuerDocuments.kind} when 'base_prospectus' then 0 when 'supplement' then 1 when 'notice' then 2 when 'final_terms' then 3 else 4 end`, issuerDocuments.title);
}

export async function issuerDocumentsFor(assetId: string): Promise<IssuerDocument[]> {
  return db.select().from(issuerDocuments).where(eq(issuerDocuments.assetId, assetId)).orderBy(desc(issuerDocuments.lastModified));
}

export async function issuerPagesAll(): Promise<IssuerPage[]> {
  return db.select().from(issuerPages).orderBy(issuerPages.slug);
}
