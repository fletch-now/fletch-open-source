// The one writer of authority_events. Jobs describe what changed; this module
// gives each change a stable id, a human title, and a row that a re-run cannot
// duplicate. Kinds are dotted strings that are added to but never renamed:
// they are part of the public API and of every subscriber's filter.

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { authorityEvents } from "@/lib/db/schema";
import { venueTitle } from "@/lib/registry/authority/constants";

export const AUTHORITY_EVENT_KINDS = [
  "registry.paused",
  "registry.unpaused",
  "registry.upgraded",
  "registry.blocked",
  "registry.unblocked",
  "registry.role",
  "token.paused",
  "token.unpaused",
  "oracle.paused",
  "oracle.unpaused",
  "token.halted",
  "token.resumed",
  "multiplier.scheduled",
  "multiplier.applied",
  "feed.stale",
  "feed.fresh",
  "supply.residual",
  "supply.reconciled",
  "token.noncanonical",
  "token.canonical",
  "listing.new",
  "listing.observed",
  "listing.added",
  "listing.changed",
  "listing.removed",
  "lookalike.found",
  "dex.pool_new",
  "dex.premium",
  "bridge.deposit",
  "bridge.withdrawal",
  "issuer.document_new",
  "issuer.document_changed",
  "issuer.document_gone",
  "issuer.page_changed",
  "chain.notice_changed",
  "chain.upgrade",
  "chain.owners_changed",
  "corporate.action",
  "chain.degraded",
  "chain.operational",
] as const;

export type AuthorityEventKind = (typeof AUTHORITY_EVENT_KINDS)[number];

// Kinds that concern the chain or the registry as a whole rather than one token.
export const CHAIN_WIDE_KINDS: ReadonlySet<AuthorityEventKind> = new Set([
  "registry.paused",
  "registry.unpaused",
  "registry.upgraded",
  "registry.blocked",
  "registry.unblocked",
  "registry.role",
  "chain.degraded",
  "chain.operational",
  "listing.new",
  "listing.observed",
  "listing.added",
  "listing.changed",
  "listing.removed",
  "lookalike.found",
  "issuer.document_new",
  "issuer.document_changed",
  "issuer.document_gone",
  "issuer.page_changed",
  "chain.notice_changed",
  "chain.upgrade",
  "chain.owners_changed",
]);

export interface AuthorityEventInput {
  chainId: number;
  kind: AuthorityEventKind;
  assetId?: string | null;
  address?: string | null;
  symbol?: string | null;
  detail?: Record<string, unknown>;
  blockNumber?: bigint | null;
  txHash?: string | null;
  occurredAt: Date;
  // Distinguishes two events of the same kind on the same subject at the same
  // moment (two accounts blocked in one block); defaults to txHash or the time.
  key?: string;
}

export function isAuthorityEventKind(value: string): value is AuthorityEventKind {
  return (AUTHORITY_EVENT_KINDS as readonly string[]).includes(value);
}

function eventId(input: AuthorityEventInput): string {
  const subject = input.assetId ?? input.address ?? "chain";
  const moment = input.key ?? input.txHash ?? input.occurredAt.toISOString();
  const digest = createHash("sha256").update(`${input.chainId}|${input.kind}|${subject}|${moment}`).digest("hex");
  return `ev_${digest.slice(0, 24)}`;
}

function text(detail: Record<string, unknown> | undefined, field: string): string {
  const value = detail?.[field];
  return value === undefined || value === null ? "" : String(value);
}

// A raw amount and its decimals from the detail, as a plain number.
function scaledText(detail: Record<string, unknown> | undefined): string {
  const raw = text(detail, "amountRaw");
  const decimals = Number(text(detail, "decimals") || 18);
  if (!/^\d+$/.test(raw)) {
    return raw;
  }
  const whole = raw.length > decimals ? raw.slice(0, raw.length - decimals) : "0";
  const fraction = raw.padStart(decimals + 1, "0").slice(-decimals).slice(0, 4).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

// What each kind is called in plain English, for chips and feeds. The raw
// kind stays in the API and behind a title attribute.
const KIND_LABELS: Record<string, string> = {
  "registry.paused": "All trading paused",
  "registry.unpaused": "Trading resumed",
  "registry.upgraded": "Registry upgraded",
  "registry.blocked": "Address blocked",
  "registry.unblocked": "Address unblocked",
  "registry.role": "Issuer role changed",
  "token.paused": "Token paused",
  "token.unpaused": "Token unpaused",
  "oracle.paused": "Price oracle paused",
  "oracle.unpaused": "Price oracle resumed",
  "token.halted": "Trading halted",
  "token.resumed": "Trading resumed",
  "multiplier.scheduled": "Stock split scheduled",
  "multiplier.applied": "Stock split applied",
  "feed.stale": "Price feed stale",
  "feed.fresh": "Price feed fresh again",
  "supply.residual": "Supply audit residual",
  "supply.reconciled": "Supply audit matched",
  "token.noncanonical": "Beacon dependency changed",
  "token.canonical": "Beacon dependency matched",
  "listing.new": "New Stock Token",
  "listing.observed": "App status first observed",
  "listing.added": "App catalog addition",
  "listing.changed": "App status changed",
  "listing.removed": "App catalog removal",
  "lookalike.found": "Name or ticker collision found",
  "dex.pool_new": "New trading pool",
  "dex.premium": "Exchange price difference",
  "bridge.deposit": "Bridge deposit",
  "bridge.withdrawal": "Bridge withdrawal",
  "issuer.document_new": "Issuer document published",
  "issuer.document_changed": "Issuer document revised",
  "issuer.document_gone": "Issuer document removed",
  "issuer.page_changed": "Issuer page changed",
  "chain.notice_changed": "Chain notice changed",
  "chain.upgrade": "Chain upgrade",
  "chain.owners_changed": "Chain owners changed",
  "corporate.action": "Corporate action",
  "chain.degraded": "Chain degraded",
  "chain.operational": "Chain operational",
};

export function eventKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

// Titles read as a changelog line; the detail carries the numbers.
export function describeEvent(input: AuthorityEventInput): string {
  const symbol = input.symbol ?? "";
  const detail = input.detail;
  switch (input.kind) {
    case "registry.paused":
      return "Every Stock Token paused by the registry";
    case "registry.unpaused":
      return "Registry pause lifted";
    case "registry.upgraded":
      return `Stock Token implementation upgraded to ${shortAddress(text(detail, "implementation"))}`;
    case "registry.blocked":
      return `Address ${shortAddress(text(detail, "account"))} blocked from holding Stock Tokens`;
    case "registry.unblocked":
      return `Address ${shortAddress(text(detail, "account"))} unblocked`;
    case "registry.role":
      return `Registry role ${text(detail, "event")} for ${shortAddress(text(detail, "account"))}`;
    case "token.paused":
      return `${symbol} paused by the issuer`;
    case "token.unpaused":
      return `${symbol} unpaused`;
    case "oracle.paused":
      return `${symbol} oracle paused`;
    case "oracle.unpaused":
      return `${symbol} oracle resumed`;
    case "token.halted":
      return `${symbol} trading halted at the issuer`;
    case "token.resumed":
      return `${symbol} trading resumed at the issuer`;
    case "multiplier.scheduled":
      return `${symbol} multiplier ${text(detail, "from")}× to ${text(detail, "to")}× scheduled for ${text(detail, "effectiveAt")}`;
    case "multiplier.applied":
      return `${symbol} multiplier now ${text(detail, "to")}× (was ${text(detail, "from")}×)`;
    case "feed.stale":
      return `${symbol} Chainlink feed past its heartbeat`;
    case "feed.fresh":
      return `${symbol} Chainlink feed updating again`;
    case "supply.residual":
      return `${symbol} supply differs from mints minus burns by ${text(detail, "residual")}`;
    case "supply.reconciled":
      return `${symbol} supply reconciles with mints minus burns again`;
    case "token.noncanonical":
      return `${symbol} contract no longer points at the registry beacon`;
    case "token.canonical":
      return `${symbol} contract points at the registry beacon again`;
    case "listing.observed":
    case "listing.added":
    case "listing.changed":
    case "listing.removed":
      return text(detail, "summary");
    case "listing.new":
      return `${symbol} listed (${text(detail, "assetType").replace("_", " ")})`;
    case "lookalike.found":
      return `Lookalike of ${symbol}: "${text(detail, "name")}" at ${shortAddress(input.address ?? "")}, ${text(detail, "holders") || "?"} holders${text(detail, "exactName") === "true" ? ", exact name" : ""}`;
    case "dex.pool_new":
      // Events written before there was a second venue carry none and read as "DEX".
      return `New ${text(detail, "venue") ? venueTitle(text(detail, "venue")) : "DEX"} pool for ${symbol}${text(detail, "quote") ? ` against ${text(detail, "quote")}` : ""}, fee ${Number(text(detail, "fee") || 0) / 10_000}%`;
    case "dex.premium":
      return `${symbol} trades ${Number(text(detail, "premiumPct")) >= 0 ? "above" : "below"} its feed by ${Math.abs(Number(text(detail, "premiumPct"))).toFixed(2)}% on Uniswap`;
    case "bridge.deposit":
      return `${symbol} bridged in from Ethereum: ${scaledText(detail)} to ${shortAddress(text(detail, "to"))}`;
    case "bridge.withdrawal":
      return `${symbol} withdrawal to Ethereum started: ${scaledText(detail)} from ${shortAddress(text(detail, "from"))}, claimable ${text(detail, "claimableAt").slice(0, 10)}`;
    case "issuer.document_new":
      return `Issuer published ${text(detail, "kind").replace("_", " ")}: ${text(detail, "title")}`;
    case "issuer.document_changed":
      return `Issuer revised ${text(detail, "kind").replace("_", " ")}: ${text(detail, "title")}`;
    case "issuer.document_gone":
      return `Issuer removed ${text(detail, "kind").replace("_", " ")}: ${text(detail, "title")}`;
    case "issuer.page_changed":
      return `Issuer page changed: ${text(detail, "page")}`;
    case "chain.notice_changed":
      return "Chain notices and upgrades page changed";
    case "chain.upgrade":
      return `ArbOS upgraded from ${text(detail, "from")} to ${text(detail, "to")}`;
    case "chain.owners_changed":
      return `Chain owners changed: now ${text(detail, "count")} owner(s)`;
    case "corporate.action":
      return `${symbol} ${text(detail, "actionType").toLowerCase().replace(/_/g, " ")}${text(detail, "effectiveDate") ? ` effective ${text(detail, "effectiveDate")}` : ""}`;
    case "chain.degraded":
      return `Chain status ${text(detail, "status")}`;
    case "chain.operational":
      return "Chain status operational";
    default:
      return input.kind;
  }
}

export async function emitEvents(inputs: AuthorityEventInput[], executor: Pick<typeof db, "insert"> = db): Promise<number> {
  if (inputs.length === 0) {
    return 0;
  }
  const rows = inputs.map(function toRow(input) {
    return {
      id: eventId(input),
      chainId: input.chainId,
      kind: input.kind,
      assetId: input.assetId ?? null,
      address: input.address ?? null,
      symbol: input.symbol ?? null,
      title: describeEvent(input),
      detail: input.detail ?? null,
      blockNumber: input.blockNumber ?? null,
      txHash: input.txHash ?? null,
      occurredAt: input.occurredAt,
      ...(input.kind.startsWith("listing.") ? { observedAt: input.occurredAt } : {}),
    };
  });
  const inserted = await executor.insert(authorityEvents).values(rows).onConflictDoNothing().returning({ id: authorityEvents.id });
  return inserted.length;
}
