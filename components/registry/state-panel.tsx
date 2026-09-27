import type { AssetState, ControlEvent, CorporateAction, MultiplierEvent, SupplyEvent, SupplySnapshot } from "@/lib/registry/authority/read";
import { ago, dayText, multiplierText, percentText, priceText, shortHex, supplyText } from "@/components/registry/format";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { InfoTip } from "@/components/registry/info-tip";
import { REGISTRY_TERMS } from "@/components/registry/terms";

// One token's live state and its histories, as the authority holds them. Each
// row names the source it came from, so a reader can tell the contract's
// answer from Chainlink's from Robinhood's.

interface StatePanelProps {
  chainId: number;
  decimals: number;
  isStock: boolean;
  state: AssetState | null;
  multipliers: MultiplierEvent[];
  supply: SupplyEvent[];
  snapshots: SupplySnapshot[];
  actions: CorporateAction[];
  control: ControlEvent[];
}

interface Row {
  label: string;
  value: string;
  source: string;
  help?: string;
  tone?: "good" | "warn";
}

const TONE = { good: "text-hood-deep", warn: "text-amber-700" };

function pendingText(state: AssetState): string {
  if (!state.multiplierEffectiveAt || !state.newUiMultiplier) {
    return "none scheduled";
  }
  const when = state.multiplierEffectiveAt.getTime() > Date.now() ? `from ${dayText(state.multiplierEffectiveAt)}` : `since ${dayText(state.multiplierEffectiveAt)}`;
  return `${multiplierText(state.newUiMultiplier)} ${when}`;
}

function rows({ state, decimals, isStock }: StatePanelProps): Row[] {
  if (!state) {
    return [];
  }
  const list: Row[] = [];
  if (isStock) {
    list.push(
      { label: "Multiplier", value: multiplierText(state.uiMultiplier), source: "uiMultiplier() on the contract", help: REGISTRY_TERMS.multiplier },
      { label: "Pending multiplier", value: pendingText(state), source: "newUIMultiplier() and effectiveAt()" },
      {
        label: "Token",
        value: state.tokenPaused === null ? "—" : state.tokenPaused ? "paused" : "transferable",
        source: "tokenPaused()",
        tone: state.tokenPaused ? "warn" : "good",
      },
      {
        label: "Oracle",
        value: state.oraclePaused === null ? "—" : state.oraclePaused ? "paused" : "live",
        source: "oraclePaused()",
        tone: state.oraclePaused ? "warn" : "good",
      },
      { label: "Supply, raw", value: supplyText(state.totalSupplyRaw, decimals), source: "totalSupply()" },
      { label: "Supply, with multiplier", value: supplyText(state.totalSupplyUi, decimals), source: "totalSupplyUI()" },
      {
        label: "Beacon dependency",
        value: state.canonical === null ? "not checked" : state.canonical ? "matches the issuer registry" : "differs from the issuer registry",
        source: state.beaconAddress ? `EIP-1967 beacon slot → ${shortHex(state.beaconAddress, 8, 6)}` : "EIP-1967 beacon slot",
        tone: state.canonical === false ? "warn" : "good",
      },
    );
  } else {
    list.push({ label: "Supply", value: supplyText(state.totalSupplyRaw, decimals), source: "totalSupply()" });
  }
  if (state.feedAddress) {
    list.push({
      label: "Feed price",
      help: REGISTRY_TERMS.feedPrice,
      value: state.feedPrice ? `${priceText(state.feedPrice)} · ${state.feedStale ? "stale" : "fresh"} · ${ago(state.feedUpdatedAt)}` : "no answer",
      source: `latestRoundData() at ${shortHex(state.feedAddress, 8, 6)}; includes the multiplier`,
      tone: state.feedStale ? "warn" : "good",
    });
  }
  if (state.apiBid) {
    list.push({
      label: "Robinhood quote",
      help: "The bid and ask reported by Robinhood for the underlying share. The token's multiplier is applied when comparing this quote with its feed price.",
      value: `${priceText(state.apiBid)} / ${priceText(state.apiAsk)}${state.apiTradingHalt ? " · halted" : ""} · ${ago(state.apiCheckedAt)}`,
      source: "api.robinhood.com/rhj/prices; the underlying share, without the multiplier",
      tone: state.apiTradingHalt ? "warn" : undefined,
    });
  }
  if (state.priceDivergencePct) {
    list.push({
      label: "Feed vs quote × multiplier",
      value: percentText(state.priceDivergencePct),
      source: "the two sources should agree while the market is open",
      tone: Math.abs(Number(state.priceDivergencePct)) > 2 ? "warn" : "good",
    });
  }
  return list;
}

function txLink(chainId: number, txHash: string) {
  return (
    <a href={explorerTxUrl(chainId, txHash)} target="_blank" rel="noreferrer" className="font-mono text-[11.5px] text-ink-faint underline-offset-4 hover:text-ink hover:underline">
      {shortHex(txHash, 8, 6)}
    </a>
  );
}

export function StatePanel(props: StatePanelProps) {
  const { state, chainId, decimals, multipliers, supply, snapshots, actions, control } = props;
  const list = rows(props);
  const latestSnapshot = snapshots[0];
  return (
    <div className="space-y-8">
      <section id="state" className="scroll-mt-28 overflow-hidden rounded-card border border-line bg-raised">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="text-[14px] font-medium text-ink">Live state</h2>
          <span className="font-mono text-[11.5px] text-ink-faint">{state ? `contract read ${ago(state.stateCheckedAt)}` : "not read yet"}</span>
        </header>
        {list.length === 0 ? (
          <p className="px-5 py-6 text-[13.5px] text-ink-soft">The registry daemon has not read this contract yet.</p>
        ) : (
          <dl className="divide-y divide-line">
            {list.map(function renderRow(row) {
              return (
                <div key={row.label} className="grid gap-1 px-5 py-3 sm:grid-cols-[180px_1fr]">
                  <dt className="flex items-start gap-1 text-[13px] text-ink-soft">{row.label}{row.help ? <InfoTip label={`About ${row.label.toLowerCase()}`} text={row.help} /> : null}</dt>
                  <dd className="min-w-0">
                    <span className={`text-[13.5px] font-medium tabular-nums ${row.tone ? TONE[row.tone] : "text-ink"}`}>{row.value}</span>
                    <span className="mt-0.5 block font-mono text-[11px] text-ink-faint">{row.source}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </section>

      {latestSnapshot ? (
        <section className="rounded-card border border-line bg-raised px-5 py-4">
          <h2 className="text-[14px] font-medium text-ink">Supply reconciliation, {latestSnapshot.day}</h2>
          <p className="mt-1.5 text-[13.5px] leading-6 text-ink-soft">
            Contract says {supplyText(latestSnapshot.totalSupplyRaw, decimals)}. Minted {supplyText(latestSnapshot.mintedRaw, decimals)}, burned{" "}
            {supplyText(latestSnapshot.burnedRaw, decimals)} since the first block. Residual{" "}
            <span className={`font-medium ${latestSnapshot.residualRaw === "0" ? "text-hood-deep" : "text-amber-700"}`}>
              {latestSnapshot.residualRaw === "0" ? "zero: every unit is accounted for" : supplyText(latestSnapshot.residualRaw, decimals)}
            </span>
            .
          </p>
        </section>
      ) : null}

      {multipliers.length > 0 ? (
        <section className="overflow-hidden rounded-card border border-line bg-raised">
          <h2 className="border-b border-line px-5 py-3 text-[14px] font-medium text-ink">Multiplier history</h2>
          <ul className="divide-y divide-line">
            {multipliers.map(function renderEvent(event) {
              return (
                <li key={event.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px]">
                  <span className="font-medium tabular-nums text-ink">
                    {multiplierText(event.oldMultiplier)} → {multiplierText(event.newMultiplier)}
                  </span>
                  <span className="text-ink-soft">effective {dayText(event.effectiveAt)}</span>
                  <span className="ml-auto">{txLink(chainId, event.txHash)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {actions.length > 0 ? (
        <section className="overflow-hidden rounded-card border border-line bg-raised">
          <h2 className="border-b border-line px-5 py-3 text-[14px] font-medium text-ink">Corporate actions</h2>
          <ul className="divide-y divide-line">
            {actions.map(function renderAction(action) {
              return (
                <li key={action.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px]">
                  <span className="font-medium text-ink">{action.kind.replace(/_/g, " ")}</span>
                  {action.rate ? <span className="tabular-nums text-ink-soft">rate {action.rate}</span> : null}
                  <span className="text-ink-soft">{action.processDate ? dayText(action.processDate) : ""}</span>
                  <span className={`ml-auto font-mono text-[11px] uppercase tracking-[0.1em] ${action.status === "completed" ? "text-ink-faint" : "text-hood-deep"}`}>
                    {action.status.replace(/_/g, " ")}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-line px-5 py-2.5 font-mono text-[11px] text-ink-faint">
            Dividends are not paid out; they raise the multiplier on the process date.
          </p>
        </section>
      ) : null}

      {supply.length > 0 ? (
        <section className="overflow-hidden rounded-card border border-line bg-raised">
          <h2 className="border-b border-line px-5 py-3 text-[14px] font-medium text-ink">Latest mints and burns</h2>
          <ul className="divide-y divide-line">
            {supply.slice(0, 12).map(function renderEvent(event) {
              return (
                <li key={event.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px]">
                  <span className={`font-mono text-[11px] uppercase tracking-[0.1em] ${event.kind === "mint" ? "text-hood-deep" : "text-amber-700"}`}>{event.kind}</span>
                  <span className="font-medium tabular-nums text-ink">{supplyText(event.valueRaw, decimals)}</span>
                  <span className="font-mono text-[11.5px] text-ink-faint">{event.kind === "mint" ? "to" : "from"} {shortHex(event.counterparty)}</span>
                  <span className="ml-auto">{txLink(chainId, event.txHash)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {control.length > 0 ? (
        <section className="overflow-hidden rounded-card border border-line bg-raised">
          <h2 className="border-b border-line px-5 py-3 text-[14px] font-medium text-ink">On the issuer&apos;s registry</h2>
          <ul className="divide-y divide-line">
            {control.map(function renderEvent(event) {
              return (
                <li key={event.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px]">
                  <span className="font-medium text-ink">{event.event}</span>
                  {event.role ? <span className="font-mono text-[11.5px] text-ink-faint">{shortHex(event.role, 10, 6)}</span> : null}
                  <span className="ml-auto">{txLink(chainId, event.txHash)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
