"use client";

import Link from "@/components/ui/navigation-link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TokenLookup } from "@/components/dashboard/watch/token-lookup";
import type { RegistryAsset } from "@/lib/registry/assets";
import type { WatcherKind } from "@/lib/watch/types";

const ASSET_TYPE_LABELS: Record<string, string> = {
  stock_token: "Stock tokens",
  stablecoin: "Stablecoins",
  wrapped_native: "Wrapped native",
  bridged: "Bridged",
};

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;

const KIND_CARDS: Array<{ kind: WatcherKind; title: string; body: string }> = [
  { kind: "large_transfer", title: "Large transfers", body: "Alert on any transfer above a threshold." },
  { kind: "wallet_activity", title: "Wallet activity", body: "Alert whenever one address sends or receives." },
  { kind: "token_event", title: "Token events", body: "Pauses, halts, multiplier changes, stale feeds, supply residuals for one token." },
  { kind: "listing_event", title: "Robinhood app changes", body: "Catalog additions, removals, price-feed status, account tradability and order-limit changes. First observations establish a baseline." },
  { kind: "registry_event", title: "Registry events", body: "The issuer's registry paused or upgraded, addresses blocked, new listings, chain status." },
  { kind: "new_pool", title: "New pools", body: "Every pool that appears on a DEX on the chain, with what the token is. One per account." },
];

const EVENT_KINDS: ReadonlySet<WatcherKind> = new Set(["token_event", "registry_event", "listing_event"]);

// Kinds with no token of their own: the chain is the target, so neither the
// asset picker nor a threshold applies.
const CHAIN_WIDE_KINDS: ReadonlySet<WatcherKind> = new Set(["registry_event", "listing_event", "new_pool"]);

const TARGETS: Array<{ key: "listed" | "address"; label: string }> = [
  { key: "listed", label: "Listed asset" },
  { key: "address", label: "Any token address" },
];

function groupByType(assets: RegistryAsset[]): Array<{ type: string; label: string; assets: RegistryAsset[] }> {
  const groups = new Map<string, RegistryAsset[]>();
  for (const asset of assets) {
    const list = groups.get(asset.assetType) ?? [];
    list.push(asset);
    groups.set(asset.assetType, list);
  }
  return Array.from(groups.entries()).map(function toGroup([type, list]) {
    return { type, label: ASSET_TYPE_LABELS[type] ?? type, assets: list };
  });
}

export interface WatcherFormWebhook {
  id: string;
  name: string;
}

interface WatcherFormProps {
  assets: RegistryAsset[];
  telegramLinked: boolean;
  // Endpoints this account has registered. Empty, the delivery choice is not
  // shown at all and every watcher goes to Telegram as before.
  webhooks: WatcherFormWebhook[];
  initialWebhookId?: string;
  initialKind?: WatcherKind;
  initialAssetId?: string;
  initialThreshold?: string;
  initialWallet?: string;
  initialProjectId?: string;
  // An address pasted from a token page: the form opens on the address target
  // with it already filled in.
  initialAddress?: string;
}

export function WatcherForm({
  assets,
  telegramLinked,
  webhooks,
  initialWebhookId,
  initialKind,
  initialAssetId,
  initialThreshold,
  initialWallet,
  initialProjectId,
  initialAddress,
}: WatcherFormProps): React.ReactNode {
  const router = useRouter();
  const groups = groupByType(assets);
  const [kind, setKind] = useState<WatcherKind>(initialKind ?? "large_transfer");
  const [assetId, setAssetId] = useState(initialAssetId ?? assets[0]?.id ?? "");
  const [threshold, setThreshold] = useState(initialThreshold ?? (initialKind === "wallet_activity" ? "0" : ""));
  const [wallet, setWallet] = useState(initialWallet ?? "");
  const [name, setName] = useState("");
  // "" is Telegram; anything else is a webhook endpoint id.
  const [webhookId, setWebhookId] = useState(webhooks.some((webhook) => webhook.id === initialWebhookId) ? initialWebhookId! : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A listed asset from the drop-down, or any address on the chain. Token and
  // registry events come from the registry, so those kinds stay on the list.
  const [target, setTarget] = useState<"listed" | "address">(initialAddress || assets.length === 0 ? "address" : "listed");
  const [address, setAddress] = useState(initialAddress ?? "");
  // Set when the server could not read an ERC-20 at the address; the watcher
  // is created only after the second, explicit submit.
  const [askedToConfirm, setAskedToConfirm] = useState(false);
  const [lookalikesOnly, setLookalikesOnly] = useState(false);

  const byAddress = target === "address" && !EVENT_KINDS.has(kind) && kind !== "new_pool";

  async function create(watchAnyway: boolean): Promise<void> {
    const needsAsset = !CHAIN_WIDE_KINDS.has(kind);
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/watchers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assetId: needsAsset && !byAddress ? assetId : undefined,
        address: byAddress ? address.trim() : undefined,
        watchAnyway: watchAnyway || undefined,
        kind,
        threshold: EVENT_KINDS.has(kind) || kind === "new_pool" ? undefined : threshold,
        lookalikesOnly: kind === "new_pool" ? lookalikesOnly : undefined,
        wallet: kind === "wallet_activity" ? wallet.trim() : undefined,
        name: name.trim() || undefined,
        projectId: initialProjectId,
        webhookId: webhookId || undefined,
      }),
    }).catch(function ignore() {
      return null;
    });
    setSubmitting(false);
    if (!response?.ok) {
      const body = await response?.json().catch(function ignore() {
        return null;
      });
      // API errors are written for people — shown verbatim rather than replaced
      // with a generic message.
      setError(body?.error ?? "Couldn't create the watcher. Try again.");
      // 422 means the address answered nothing the server could check. The
      // watcher is still possible, with the user saying so.
      setAskedToConfirm(response?.status === 422 && body?.retryWith === "watchAnyway");
      return;
    }
    router.push("/dashboard/watch");
    router.refresh();
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (byAddress && !WALLET_PATTERN.test(address.trim())) {
      setError("Paste the 0x address of the token, 40 hex characters.");
      return;
    }
    if (!CHAIN_WIDE_KINDS.has(kind) && !byAddress && !assetId) {
      setError("Pick an asset.");
      return;
    }
    if (kind === "wallet_activity" && !WALLET_PATTERN.test(wallet.trim())) {
      setError("Enter a wallet address (0x followed by 40 hex characters).");
      return;
    }
    await create(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-lg flex-col gap-5">
      {!telegramLinked && webhookId === "" ? (
        <p className="rounded-card border border-line bg-panel/50 px-4 py-3 text-[13px] text-ink-soft">
          Telegram is not linked yet. You can still create this watcher. Link Telegram in{" "}
          <Link href="/dashboard/settings" className="underline underline-offset-4">
            Settings
          </Link>{" "}
          for notifications too. Matches are saved in your dashboard.
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">Kind</span>
        <div className="grid grid-cols-2 gap-3">
          {KIND_CARDS.map(function renderCard(card) {
            const selected = kind === card.kind;
            return (
              <button
                key={card.kind}
                type="button"
                onClick={function onSelect() {
                  setKind(card.kind);
                  // Wallet activity's threshold field defaults to "every
                  // transfer" rather than sitting empty (which the server
                  // would reject as not a number).
                  if (card.kind === "wallet_activity" && threshold.trim() === "") {
                    setThreshold("0");
                  }
                }}
                aria-pressed={selected}
                className={`flex flex-col items-start gap-1 rounded-card border px-4 py-3 text-left transition-colors ${
                  selected ? "border-hood bg-hood-wash" : "border-line bg-raised hover:border-line-strong"
                }`}
              >
                <span className={`text-[13.5px] font-medium ${selected ? "text-hood-deep" : "text-ink"}`}>{card.title}</span>
                <span className="text-[12.5px] leading-5 text-ink-soft">{card.body}</span>
              </button>
            );
          })}
        </div>
      </div>

      {kind === "registry_event" ? (
        <p className="rounded-card border border-line bg-panel/50 px-4 py-3 text-[13px] leading-5 text-ink-soft">
          Watches the issuer&apos;s AccessControlsRegistry on mainnet and the chain itself. One watcher covers every Stock Token.
        </p>
      ) : null}

      {kind === "new_pool" ? (
        <div className="flex flex-col gap-3">
          <p className="rounded-card border border-line bg-panel/50 px-4 py-3 text-[13px] leading-5 text-ink-soft">
            Watches the exchanges covered by the registry. You hear about a pool once the registry has read it, with what its token is and how
            deep the pool was at that moment. One watcher covers the chain, so an account has one.
          </p>
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={lookalikesOnly}
              onChange={function onToggle(event) {
                setLookalikesOnly(event.target.checked);
              }}
              className="mt-0.5 h-4 w-4 rounded border-line"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium text-ink">Only pools whose token borrows a listed ticker</span>
              <span className="text-[12.5px] leading-5 text-ink-soft">
                Off, you see recorded pools. On, you see pools using a verified Stock Token ticker.
              </span>
            </span>
          </label>
        </div>
      ) : null}

      {CHAIN_WIDE_KINDS.has(kind) ? null : (
        <div className="flex flex-col gap-3">
          {EVENT_KINDS.has(kind) ? null : (
            <div className="flex items-center gap-2">
              {TARGETS.map(function renderTarget(entry) {
                const selected = target === entry.key;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={function onPick() {
                      setTarget(entry.key);
                      setAskedToConfirm(false);
                    }}
                    aria-pressed={selected}
                    className={`h-11 rounded-full border px-3.5 text-[13px] transition-colors ${
                      selected ? "border-ink bg-ink text-paper" : "border-line bg-raised text-ink-soft hover:border-line-strong hover:text-ink"
                    }`}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
          )}

          {byAddress ? (
            <TokenLookup
              value={address}
              onChange={function onAddress(next) {
                setAddress(next);
                setAskedToConfirm(false);
              }}
            />
          ) : null}

          {!byAddress && assets.length === 0 ? (
            <p className="rounded-card border border-dashed border-line bg-panel/40 px-4 py-3 text-[13px] leading-5 text-ink-soft">
              The registry has not synced any listed assets yet. Paste a token address instead.
            </p>
          ) : null}

          {!byAddress && assets.length > 0 ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink">Asset</span>
              <select
                value={assetId}
                onChange={function onChange(event) {
                  setAssetId(event.target.value);
                }}
                className="h-11 rounded-md border border-line bg-raised px-3 text-[14px] text-ink outline-none focus:border-line-strong"
              >
                {groups.map(function renderGroup(group) {
                  return (
                    <optgroup key={group.type} label={group.label}>
                      {group.assets.map(function renderAsset(asset) {
                        return (
                          <option key={asset.id} value={asset.id}>
                            {asset.symbol}: {asset.name}
                          </option>
                        );
                      })}
                    </optgroup>
                  );
                })}
              </select>
            </label>
          ) : null}
        </div>
      )}

      {kind === "wallet_activity" ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">Wallet address</span>
          <input
            type="text"
            value={wallet}
            onChange={function onChange(event) {
              setWallet(event.target.value);
            }}
            placeholder="0x…"
            className="h-11 rounded-md border border-line bg-raised px-3 font-mono text-[14px] text-ink outline-none focus:border-line-strong"
          />
          <span className="text-[12.5px] text-ink-faint">Alerts when this address sends or receives the asset above.</span>
        </label>
      ) : null}

      {EVENT_KINDS.has(kind) || kind === "new_pool" ? null : (
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">
          {kind === "wallet_activity" ? "Minimum amount, 0 for every transfer" : "Threshold"}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={threshold}
          onChange={function onChange(event) {
            setThreshold(event.target.value);
          }}
          placeholder={kind === "wallet_activity" ? "0" : "e.g. 1000"}
          className="h-11 rounded-md border border-line bg-raised px-3 font-mono text-[14px] text-ink outline-none focus:border-line-strong"
        />
        <span className="text-[12.5px] text-ink-faint">
          {kind === "wallet_activity"
            ? "Whole tokens. Leave at 0 to hear about every transfer touching this wallet."
            : "Whole tokens. Alerts when a transfer is at or above this."}
        </span>
      </label>
      )}

      {webhooks.length > 0 ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">Notification channel</span>
          <select
            value={webhookId}
            onChange={function onChange(event) {
              setWebhookId(event.target.value);
            }}
            className="h-11 rounded-md border border-line bg-raised px-3 text-[14px] text-ink outline-none focus:border-line-strong"
          >
            <option value="">Telegram</option>
            {webhooks.map(function renderWebhook(webhook) {
              return (
                <option key={webhook.id} value={webhook.id}>
                  {webhook.name} (webhook)
                </option>
              );
            })}
          </select>
          <span className="text-[12.5px] text-ink-faint">
            A webhook gets the same alert as a signed JSON POST. Add endpoints in Settings.
          </span>
        </label>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">Name (optional)</span>
        <input
          type="text"
          value={name}
          onChange={function onChange(event) {
            setName(event.target.value);
          }}
          placeholder="Defaults to the asset and threshold"
          className="h-11 rounded-md border border-line bg-raised px-3 text-[14px] text-ink outline-none focus:border-line-strong"
        />
      </label>

      {error ? <p className="text-[13.5px] text-red-600">{error}</p> : null}

      {askedToConfirm ? (
        <div className="flex flex-col gap-2 rounded-card border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="text-[13px] leading-5 text-amber-900">
            Fletch will watch transfers at this address without knowing what the contract is. Alerts will say so.
          </span>
          <button
            type="button"
            disabled={submitting}
            onClick={function confirm() {
              void create(true);
            }}
            className="h-11 self-start rounded-full border border-amber-300 bg-white px-4 text-[13px] font-medium text-amber-900 transition-colors hover:border-amber-400 disabled:opacity-50"
          >
            Watch anyway
          </button>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="flex h-11 items-center justify-center rounded-full bg-hood px-5 text-[13.5px] font-semibold text-black transition-colors hover:bg-hood-strong disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create watcher"}
      </button>
    </form>
  );
}
