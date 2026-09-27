import Link from "@/components/ui/navigation-link";
import { REGISTRY_TERMS } from "@/components/registry/terms";

// What this registry is, in two voices: one for someone who trades these
// tokens, one for someone who builds on them. Then the words the table uses,
// each explained once. Plain HTML details, so it works without a script.

const TRADER_POINTS = [
  { title: "Check the address", body: "Robinhood's list identifies an address for each listed asset. Fletch records the contract's symbol, decimals and available issuer checks. A token at another address can reuse the name." },
  { title: "Read the latest state", body: "Contract pause flags and Robinhood's trading-halt status have separate sources and observation times. An unavailable or old reading does not establish the current state." },
  { title: "Compare prices", body: "Where available, the token page separates the on-chain feed, Robinhood quote and selected DEX pool price. Thin pools and old quotes can make comparisons unreliable." },
  { title: "Inspect recorded changes", body: "Multiplier changes, pauses and other observed events appear in the token history. Coverage depends on the blocks and sources the indexers have reached." },
];

const BUILDER_POINTS = [
  { title: "Identity evidence", body: "Use the full address and recorded listing, contract and bridge checks. The badge describes that evidence; it does not guarantee price, liquidity or transfer success." },
  { title: "Readings as JSON", body: "API responses include the available state and market measurements with source times. Preserve unavailable values and their reasons when presenting them in another app." },
  { title: "Supply reconciliation", body: "Supply can be compared with indexed mints and burns only when the required history is available. An incomplete ledger cannot establish the current holder distribution." },
  { title: "History and events", body: "Recorded changes are available through paginated endpoints and Server-Sent Events. The public MCP server exposes these reads to compatible clients." },
];

const GLOSSARY: Array<{ term: string; meaning: string }> = [
  { term: "Stock Token", meaning: "An ERC-20 issued by Robinhood Assets (Jersey) Limited for exposure to a listed share. Consult the issuer's terms for the rights attached to that instrument." },
  { term: "Canonical", meaning: "The recorded EIP-1967 beacon-slot check points to the issuer's AccessControlsRegistry. This records a dependency with its own observation time; issuer origin requires listing or verified deployment evidence." },
  { term: "Multiplier", meaning: REGISTRY_TERMS.multiplier },
  { term: "Paused / halted", meaning: "Pause readings come from the token or oracle contract. Trading-halt readings come from Robinhood's API. Each can become stale independently." },
  { term: "Feed price", meaning: REGISTRY_TERMS.feedPrice },
  { term: "DEX price", meaning: REGISTRY_TERMS.dexPrice },
  { term: "Reading times", meaning: REGISTRY_TERMS.freshness },
  { term: "Pool", meaning: REGISTRY_TERMS.pool },
  { term: "24h volume", meaning: REGISTRY_TERMS.volume },
  { term: "Market cap estimate", meaning: REGISTRY_TERMS.marketCap },
  { term: "Quote", meaning: "Robinhood's API bid and ask for the underlying share. The comparison adjusts for the token's multiplier when available." },
  { term: "Premium", meaning: REGISTRY_TERMS.premium },
  { term: "Residual", meaning: "The difference between contract supply and indexed mints minus burns. A value is useful only alongside the ledger's coverage." },
  { term: "Lookalike", meaning: "A token at another address with a matching listed name or ticker. The match does not establish the deployer's intent." },
  { term: "Float", meaning: "The measured supply share held in addresses classified as ordinary wallets. Missing history or unclassified addresses limits the result." },
  { term: "Filling", meaning: "The indexer has not reached the required history boundary. Coverage and dependent measurements remain incomplete." },
  { term: "Authority event", meaning: "A change observed by Fletch, such as a pause, multiplier update or new listing. Its record identifies the source and observation time." },
];

interface ExplainerProps {
  compact?: boolean;
}

export function RegistryExplainer({ compact = false }: ExplainerProps = {}) {
  if (compact) {
    return (
      <section className="rounded-card border border-line bg-raised px-5 py-4">
        <p className="mono-label">Reading the registry</p>
        <ul className="mt-2 divide-y divide-line">
          {TRADER_POINTS.map(function renderPoint(point) {
            return (
              <li key={point.title} className="py-2">
                <p className="text-[13.5px] font-medium text-ink">{point.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-5 text-ink-soft">{point.body}</p>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[12.5px]">
          <Link href="/developers" className="text-hood-deep underline underline-offset-4 hover:text-ink">
            Read the API reference
          </Link>
        </p>
      </section>
    );
  }
  return (
    <section className="mt-10 grid gap-4 lg:grid-cols-2">
      <div className="rounded-card border border-line bg-raised px-5 py-5">
        <p className="mono-label">if you trade these tokens</p>
        <ul className="mt-3 divide-y divide-line">
          {TRADER_POINTS.map(function renderPoint(point) {
            return (
              <li key={point.title} className="py-2.5">
                <p className="text-[14px] font-medium text-ink">{point.title}</p>
                <p className="mt-0.5 text-[13px] leading-5 text-ink-soft">{point.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="rounded-card border border-line bg-raised px-5 py-5">
        <p className="mono-label">if you build on them</p>
        <ul className="mt-3 divide-y divide-line">
          {BUILDER_POINTS.map(function renderPoint(point) {
            return (
              <li key={point.title} className="py-2.5">
                <p className="text-[14px] font-medium text-ink">{point.title}</p>
                <p className="mt-0.5 text-[13px] leading-5 text-ink-soft">{point.body}</p>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[13px]">
          <Link href="/developers" className="text-hood-deep underline underline-offset-4 hover:text-ink">
            Read the API reference
          </Link>
        </p>
      </div>
    </section>
  );
}

export function RegistryGlossary() {
  return (
    <details className="group rounded-card border border-line bg-raised">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[14px] font-medium text-ink">
        Registry terms
        <span className="text-[12px] text-ink-faint group-open:hidden">show</span>
        <span className="hidden text-[12px] text-ink-faint group-open:inline">hide</span>
      </summary>
      <dl className="grid gap-x-8 gap-y-3 border-t border-line px-5 py-4 md:grid-cols-2">
        {GLOSSARY.map(function renderTerm(entry) {
          return (
            <div key={entry.term}>
              <dt className="text-[13.5px] font-medium text-ink">{entry.term}</dt>
              <dd className="mt-0.5 text-[12.5px] leading-5 text-ink-soft">{entry.meaning}</dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}
