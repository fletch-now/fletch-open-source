import Link from "@/components/ui/navigation-link";
import { requireAdmin } from "@/lib/dal";
import { discoveredTokenCounts, listDiscoveredTokens } from "@/lib/admin/queries";
import { setDiscoveryFloor, setPriceFloor, setTokenHidden } from "@/lib/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { EmptyState, PageHeader, Panel, Stat, StatGrid, StatusChip, Table, Time } from "@/components/dashboard/ui";
import { TrustBadge } from "@/components/registry/trust-badge";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { discoveryFloorUsd, priceFloorUsd } from "@/lib/admin/settings";
import { trustForTokens } from "@/lib/registry/trust";
import { RH_MAINNET_ID } from "@/lib/config";

const SOURCE_LABEL: Record<string, string> = {
  factory_scan: "factory scan",
  user_submitted: "pasted by a user",
};

function depthText(value: number | null): string {
  if (value === null) {
    return "—";
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

// Every token discovery has met, newest first, with where it came from and
// what the trust rules make of it. Hiding one keeps the row and everything
// read from it; it only takes the token out of default listings, so a watcher
// already pointed at it keeps working.
export default async function AdminTokensPage({ searchParams }: PageProps<"/trafalgar/tokens">) {
  await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const [counts, tokens, floor, priceFloor] = await Promise.all([
    discoveredTokenCounts(RH_MAINNET_ID),
    listDiscoveredTokens(RH_MAINNET_ID, q),
    discoveryFloorUsd(),
    priceFloorUsd(),
  ]);
  const trust = await trustForTokens(
    RH_MAINNET_ID,
    tokens.map((token) => token.address),
  );

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Discovered tokens"
        description={`Chain ${RH_MAINNET_ID}. Every ERC-20 the pool scan or a pasted watcher address has brought in, with what the contract answered and where the row came from. Nothing here is deleted: hiding takes a token out of default listings and leaves it resolvable by address.`}
      />

      <div className="mb-6">
        <StatGrid>
          <Stat label="Tokens on record" value={counts.total.toLocaleString("en-US")} hint="found in a pool or pasted into a watcher" />
          <Stat label="Read" value={counts.read.toLocaleString("en-US")} hint="answered name, symbol and decimals" tone="good" />
          <Stat label="Not read yet" value={counts.unread.toLocaleString("en-US")} hint="queued for the token reader" tone={counts.unread > 0 ? "warn" : "good"} />
          <Stat label="Pasted by users" value={counts.userSubmitted.toLocaleString("en-US")} hint="an address someone put in a watcher" />
          <Stat label="Hidden" value={counts.hidden.toLocaleString("en-US")} hint="out of default listings by an operator" />
          <Stat label="Listing floor" value={`$${floor.toLocaleString("en-US")}`} hint="depth a token needs to show in default listings" />
          <Stat label="Price floor" value={`$${priceFloor.toLocaleString("en-US")}`} hint="quote-side depth a pool needs before its price is published" />
        </StatGrid>
      </div>

      <div className="mb-6">
        <Panel
          title="Spam threshold"
          description="Dollars of pool depth a discovered token needs before default listings show it. A launchpad can make thousands of empty pools in a week; this keeps them off the front of the market table without losing them."
        >
          <ActionForm action={setDiscoveryFloor} fields={{}} label="Save floor" tone="primary">
            <input
              type="number"
              name="floor"
              min={0}
              max={1000000}
              step={1}
              defaultValue={floor}
              className="h-9 w-32 rounded-full border border-line bg-paper px-4 font-mono text-[13px] text-ink focus:border-hood/60 focus:outline-none"
            />
          </ActionForm>
        </Panel>
      </div>

      <div className="mb-6">
        <Panel
          title="Price floor"
          description="Dollars of quote-side depth a pool needs before its price, change windows, FDV and market cap are published. Below it every derived column reads as a dash: a pool holding sixty dollars can be traded against itself into any price at all, and that price is what the front page would otherwise rank and quote."
        >
          <ActionForm action={setPriceFloor} fields={{}} label="Save floor" tone="primary">
            <input
              type="number"
              name="floor"
              min={0}
              max={1000000}
              step={1}
              defaultValue={priceFloor}
              className="h-9 w-32 rounded-full border border-line bg-paper px-4 font-mono text-[13px] text-ink focus:border-hood/60 focus:outline-none"
            />
          </ActionForm>
        </Panel>
      </div>

      <form method="get" className="mb-4 flex items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="symbol, name, or address"
          className="h-9 w-64 rounded-full border border-line bg-paper px-4 text-[13px] text-ink placeholder:text-ink-faint focus:border-hood/60 focus:outline-none"
        />
        <button type="submit" className="h-9 rounded-full bg-ink px-4 text-[12.5px] font-medium text-paper">
          Search
        </button>
        <Link href="/registry/markets" className="ml-auto text-[12.5px] text-ink-soft underline underline-offset-4 hover:text-ink">
          the public market table
        </Link>
      </form>

      {tokens.length === 0 ? (
        <EmptyState title={q ? "No token matches" : "Nothing discovered yet"} body={q ? "Try a symbol or an address." : "The pool scan fills this as it reads the chain."} />
      ) : (
        <Table
          dense
          columns={[
            { key: "token", label: "token" },
            { key: "trust", label: "trust" },
            { key: "source", label: "source" },
            { key: "pools", label: "pools", align: "right" },
            { key: "depth", label: "depth", align: "right" },
            { key: "seen", label: "first seen", align: "right" },
            { key: "action", label: "", align: "right" },
          ]}
          rows={tokens.map(function renderToken(token) {
            const verdict = trust.get(token.address);
            return [
              <span key="t" className="flex flex-col gap-0.5">
                <Link href={`/registry/markets/${token.address}`} className="font-mono text-[12.5px] font-medium text-ink underline-offset-4 hover:underline">
                  {token.symbol ?? "—"}
                </Link>
                <a
                  href={explorerAddressUrl(RH_MAINNET_ID, token.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[11px] text-ink-faint underline-offset-4 hover:underline"
                >
                  {token.address}
                </a>
              </span>,
              <span key="v" className="flex items-center gap-2">
                {verdict ? <TrustBadge level={verdict.level} detail={verdict.detail} /> : null}
                {token.hidden ? <StatusChip tone="warn">hidden</StatusChip> : null}
              </span>,
              <span key="s" className="text-[12px] text-ink-faint">{SOURCE_LABEL[token.source] ?? token.source}</span>,
              <span key="p" className="font-mono text-[12px] text-ink-soft">{token.pools}</span>,
              <span key="d" className="font-mono text-[12px] text-ink-soft">{depthText(token.depthUsd)}</span>,
              <Time key="f" at={token.firstSeenAt} className="font-mono text-[11.5px] text-ink-faint" />,
              <ActionForm
                key="a"
                action={setTokenHidden}
                fields={{ address: token.address, hidden: token.hidden ? "false" : "true" }}
                label={token.hidden ? "Show" : "Hide"}
                tone={token.hidden ? "neutral" : "danger"}
              />,
            ];
          })}
        />
      )}
    </div>
  );
}
