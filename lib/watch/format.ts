// Turns one matched Transfer log into the outbox payload and, from that payload,
// the Telegram message text (docs/MVP.md, ticket 6). Kept separate from
// poll.ts/deliver.ts so the wording can change without touching either loop.

import { decodeAmount } from "@/lib/chain/logs";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { escapeHtml } from "@/lib/telegram/client";
import type { DeliveryChannel, DeliveryPayload, TrustStamp, WatcherKind } from "@/lib/watch/types";

export interface BuildPayloadParams {
  kind: WatcherKind;
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  from: string;
  to: string;
  value: bigint;
  threshold: string;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  // wallet_activity only — the watched address and which side of the transfer
  // it was on. Required together when kind is "wallet_activity".
  wallet?: string;
  direction?: "in" | "out";
  // What the registry could say about this token when the alert was raised.
  trust?: TrustStamp;
}

// bigint fields travel as strings from here on — they're headed for jsonb and,
// eventually, JSON.stringify in a route response; neither survives a raw bigint.
export function buildPayload(params: BuildPayloadParams): DeliveryPayload {
  const base = {
    chainId: params.chainId,
    address: params.address,
    symbol: params.symbol,
    name: params.name,
    decimals: params.decimals,
    from: params.from,
    to: params.to,
    value: params.value.toString(),
    amount: decodeAmount(params.value, params.decimals),
    threshold: params.threshold,
    txHash: params.txHash,
    logIndex: params.logIndex,
    blockNumber: params.blockNumber.toString(),
    blockHash: params.blockHash,
    explorerUrl: explorerTxUrl(params.chainId, params.txHash),
    trust: params.trust,
  };

  if (params.kind === "wallet_activity") {
    if (!params.wallet || !params.direction) {
      throw new Error("wallet_activity payload requires wallet and direction");
    }
    return { ...base, kind: "wallet_activity", wallet: params.wallet, direction: params.direction };
  }
  return { ...base, kind: "large_transfer" };
}

// Where a watcher's alerts go, in the words the dashboard uses in three places.
// A webhook whose endpoint was deleted says so rather than reading as Telegram.
export function deliveryTargetLabel(delivery: DeliveryChannel, webhookName: string | null): string {
  if (delivery !== "webhook") {
    return "Telegram";
  }
  return webhookName ? `${webhookName} (webhook)` : "a deleted webhook endpoint";
}

export function truncateAddress(address: string): string {
  if (address.length <= 10) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// Shared across both message kinds — kept as one constant so the wording
// only needs to change in one place.
const UNCONFIRMED_FOOTER = "Sequencer-confirmed; not yet final on Ethereum.";

// One line saying what the token is, on every transfer alert. A person acting
// on an alert about a token called TSLA needs to know, in the message itself,
// whether it is the listed one — the warning is worthless a click away.
// Payloads written before trust stamps existed carry none and get no line.
function trustLine(trust: TrustStamp | undefined): string | null {
  if (!trust) {
    return null;
  }
  switch (trust.level) {
    case "verified":
      return "✅ Verified — on Robinhood's list and confirmed against the chain";
    case "listed":
      return "◻️ Listed by Robinhood, not yet confirmed against the chain";
    case "lookalike": {
      const of = trust.impersonates ? ` of ${escapeHtml(trust.impersonates.symbol)}` : "";
      const real = trust.impersonates ? `\nVerified address: ${escapeHtml(trust.impersonates.address)}` : "";
      return `⚠️ <b>LOOKALIKE${of}</b> — this is NOT the verified token.${real}`;
    }
    case "community":
      return "🌐 Community token — not listed by Robinhood, unverified";
    default:
      return "❓ Unknown token — could not be resolved";
  }
}

// Every transfer message is the same four parts: what happened, who moved it,
// where to look, and what the token is.
function transferLines(headline: string, middle: string[], payload: { explorerUrl: string; trust?: TrustStamp }): string {
  const stamp = trustLine(payload.trust);
  return [headline, ...middle, `<a href="${escapeHtml(payload.explorerUrl)}">view on explorer</a>`, ...(stamp ? [stamp] : []), UNCONFIRMED_FOOTER].join("\n");
}

// decodeAmount's output is a plain digit string ("1250000" or "1250000.5") —
// comma-group only the whole part, leave any fraction untouched.
function formatAmount(amount: string): string {
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole, fraction] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative ? "-" : "";
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}

function formatLargeTransfer(payload: Extract<DeliveryPayload, { kind: "large_transfer" }>): string {
  const symbol = escapeHtml(payload.symbol);
  const amount = formatAmount(payload.amount);
  const from = truncateAddress(payload.from);
  const to = truncateAddress(payload.to);
  return transferLines(`<b>Large ${symbol} transfer</b>`, [`${amount} ${symbol}`, `from ${from} · to ${to}`], payload);
}

function formatWalletActivity(payload: Extract<DeliveryPayload, { kind: "wallet_activity" }>): string {
  const symbol = escapeHtml(payload.symbol);
  const amount = formatAmount(payload.amount);
  const wallet = escapeHtml(truncateAddress(payload.wallet));
  const verb = payload.direction === "in" ? "received" : "sent";
  const counterpartyLabel = payload.direction === "in" ? "from" : "to";
  const counterparty = escapeHtml(truncateAddress(payload.direction === "in" ? payload.from : payload.to));
  return transferLines(`<b>${wallet} ${verb} ${amount} ${symbol}</b>`, [`${counterpartyLabel} ${counterparty}`], payload);
}

// HTML parse mode, short by design — this is a push notification, not a report.
// Symbol/name come from the registry (ticket 2's zod-validated sync), but they're
// still third-party data, so they're escaped like anything else headed into HTML.
export function formatTelegram(payload: DeliveryPayload): string {
  switch (payload.kind) {
    case "wallet_activity":
      return formatWalletActivity(payload);
    case "authority":
      return formatAuthority(payload);
    case "new_pool":
      return formatNewPool(payload);
    default:
      return formatLargeTransfer(payload);
  }
}

// A launch, with what the registry had actually read at the moment it was
// found. A pool nobody has priced yet says so; it never shows a zero for a
// figure that was not read.
function formatNewPool(payload: Extract<DeliveryPayload, { kind: "new_pool" }>): string {
  const symbol = escapeHtml(payload.symbol ?? truncateAddress(payload.tokenAddress ?? ""));
  const quote = payload.quote ? ` / ${escapeHtml(payload.quote)}` : "";
  const lines = [`<b>New pool: ${symbol}${quote}</b>`, `on ${escapeHtml(payload.venue.replace("_", " "))}`];
  const stamp = trustLine(payload.trust);
  if (stamp) {
    lines.push(stamp);
  }
  lines.push(`price ${usdOrDash(payload.priceUsd)} · depth ${usdOrDash(payload.depthUsd)}`);
  if (payload.explorerUrl) {
    lines.push(`<a href="${escapeHtml(payload.explorerUrl)}">view on explorer</a>`);
  }
  lines.push(`<a href="${escapeHtml(payload.tokenUrl)}">what this token is</a>`);
  return lines.join("\n");
}

// A dash is a figure the registry has not read. It is never a zero.
function usdOrDash(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "—";
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(1)}K`;
  }
  if (amount >= 0.01) {
    return `$${amount.toFixed(2)}`;
  }
  return `$${amount.toPrecision(3)}`;
}

// One line of headline, one of where it came from. Chain-wide events carry no
// symbol; the title already says what happened.
function formatAuthority(payload: Extract<DeliveryPayload, { kind: "authority" }>): string {
  const lines = [`<b>${escapeHtml(payload.title)}</b>`];
  if (payload.explorerUrl) {
    lines.push(`<a href="${escapeHtml(payload.explorerUrl)}">view on explorer</a>`);
  }
  lines.push(`<a href="${escapeHtml(payload.registryUrl)}">registry changelog</a>`);
  if (payload.eventKind.startsWith("listing.")) {
    lines.push(`Observed ${escapeHtml(payload.occurredAt)}`);
    lines.push(`<a href="https://nummus.robinhood.com/currency_pairs/">Source: Robinhood crypto catalog</a>`);
  }
  lines.push(`Fletch registry · ${escapeHtml(payload.eventKind)}`);
  return lines.join("\n");
}
