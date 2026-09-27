import Link from "@/components/ui/navigation-link";
import type { AuthoritySummary, ChainHealthRow, ControlState } from "@/lib/registry/authority/read";
import type { LedgerProgress } from "@/lib/registry/authority/ledger";
import { ago, olderThan, shortHex } from "@/components/registry/format";
import { InfoTip } from "@/components/registry/info-tip";

// The security scorecard: one verdict line, six plain-English figures with the
// exact mechanism behind each one a "?" away, and a footer with the chain's
// pulse. Every figure is read from the authority tables; nothing is computed
// at render time, so the card is exactly as fresh as the daemon.

interface AuthorityStripProps {
  summary: AuthoritySummary;
  control: ControlState | null;
  health: ChainHealthRow | null;
  stockTokens: number;
  ledger: LedgerProgress;
  // "row" is the wide card under a page title; "rail" stacks the same figures
  // in a narrow column beside a table.
  layout?: "row" | "rail";
}

type Tone = "good" | "warn" | "bad" | "neutral";

interface Metric {
  label: string;
  value: string;
  badge: string;
  tone: Tone;
  // What the figure is, mechanically. Shown behind the "?".
  mechanism: string;
  href?: string;
}

function verifiedMetric(summary: AuthoritySummary, stockTokens: number): Metric {
  const all = stockTokens > 0 && summary.canonical === stockTokens;
  return {
    label: "Verified stocks",
    value: `${summary.canonical} of ${stockTokens}`,
    badge: all ? "beacon confirmed" : `${stockTokens - summary.canonical} unproven`,
    tone: all ? "good" : "bad",
    mechanism:
      "Each Stock Token is a BeaconProxy whose EIP-1967 beacon slot points at Robinhood's AccessControlsRegistry, read from the chain every six hours. A contract with the right name and symbol at another address does not pass.",
    href: "/registry?type=stock",
  };
}

function lookalikeMetric(summary: AuthoritySummary): Metric {
  return {
    label: "Identity collisions",
    value: summary.lookalikes > 0 ? summary.lookalikes.toLocaleString("en-US") : "none",
    badge: summary.exactNameLookalikes > 0 ? `${summary.exactNameLookalikes} exact name matches` : "no exact name matches",
    tone: summary.exactNameLookalikes > 0 ? "warn" : "good",
    mechanism:
      "Recorded contracts whose names or tickers match a listed asset at a different address. The scan retains the contract evidence and observation time. A matching label establishes a collision; intent requires separate evidence.",
    href: "/registry/lookalikes",
  };
}

function supplyMetric(summary: AuthoritySummary): Metric {
  const base =
    "A daily reconciliation of the supply each contract reports against the sum of its own mint and burn events since genesis, plus an hourly check of the same figure against the explorer. This is the on-chain ledger only; reserve custody is the issuer's claim, which Fletch does not see.";
  if (!summary.supplySnapshotDay) {
    return { label: "Supply audit", value: "first pass pending", badge: "reading history", tone: "neutral", mechanism: base };
  }
  if (summary.supplyMismatches === 0) {
    return { label: "Supply audit", value: "ledger matched", badge: `audited ${summary.supplySnapshotDay}`, tone: "good", mechanism: base };
  }
  return {
    label: "Supply audit",
    value: `${summary.supplyMismatches} with a residual`,
    badge: `audited ${summary.supplySnapshotDay}`,
    tone: "warn",
    mechanism: base,
    href: "/registry?state=residual",
  };
}

function feedMetric(summary: AuthoritySummary): Metric {
  return {
    label: "Live price feeds",
    value: `${summary.feedsRead} live`,
    badge: summary.feedsStale > 0 ? `${summary.feedsStale} stale` : "0 stale",
    tone: summary.feedsStale > 0 ? "warn" : "good",
    mechanism:
      "On-chain price feeds on Robinhood Chain, one per listed asset, read by Fletch every minute. A feed is stale when its last round is older than the feed's own heartbeat; the price shown is round price times the token's multiplier.",
    href: "/registry?state=feed",
  };
}

function splitMetric(summary: AuthoritySummary): Metric {
  return {
    label: "Stock splits",
    value: summary.withPendingMultiplier > 0 ? `${summary.withPendingMultiplier} pending` : "none pending",
    badge: summary.withPendingMultiplier > 0 ? "balances will change" : "no adjustments due",
    tone: summary.withPendingMultiplier > 0 ? "warn" : "good",
    mechanism:
      "Each Stock Token exposes uiMultiplier() and a scheduled next value. Balances are shown as units times multiplier, so a split changes what a holder sees without moving tokens. Fletch reads the schedule every five minutes and announces each change.",
    href: "/registry?state=split",
  };
}

function blockedMetric(control: ControlState | null): Metric {
  if (!control) {
    return { label: "Blocked addresses", value: "not read yet", badge: "waiting", tone: "neutral", mechanism: BLOCKED_MECHANISM };
  }
  return {
    label: "Blocked addresses",
    value: control.blockedCount === null ? "unknown" : control.blockedCount.toLocaleString("en-US"),
    badge: control.paused ? "registry paused" : "registry live",
    tone: control.paused ? "bad" : "good",
    mechanism: BLOCKED_MECHANISM,
    href: "/registry/changes?kind=registry",
  };
}

const BLOCKED_MECHANISM =
  "The issuer's AccessControlsRegistry holds a blocklist that every Stock Token checks on transfer, plus a global pause. Fletch reads it every twenty seconds and records each block, unblock, pause and role change as an event. Why an address was blocked is the issuer's decision, not visible on chain.";

function metrics(props: AuthorityStripProps): Metric[] {
  return [
    verifiedMetric(props.summary, props.stockTokens),
    lookalikeMetric(props.summary),
    supplyMetric(props.summary),
    feedMetric(props.summary),
    splitMetric(props.summary),
    blockedMetric(props.control),
  ];
}

// Token state is read every five minutes; half an hour without a read means
// the figures are history, not the present, and the verdict says so.
const STATE_LATE_MS = 30 * 60_000;

interface Verdict {
  tone: Tone;
  title: string;
  detail: string;
}

// One line at the top: green when every check that can fail passes, amber for
// something to look at, red when trading itself is affected.
function verdict({ summary, control, health, stockTokens }: AuthorityStripProps): Verdict {
  const chainDown = health !== null && health.statusPage !== null && health.statusPage !== "OPERATIONAL";
  if (control?.paused) {
    return { tone: "bad", title: "Trading paused by the issuer", detail: "Every Stock Token is paused through the registry." };
  }
  if (chainDown) {
    return { tone: "bad", title: "Chain reporting an incident", detail: `Robinhood's status page reads ${health?.statusPage?.toLowerCase()}.` };
  }
  if (stockTokens > 0 && summary.canonical < stockTokens) {
    return { tone: "bad", title: "A listed token failed verification", detail: `${stockTokens - summary.canonical} of ${stockTokens} Stock Tokens do not prove to the issuer's registry.` };
  }
  const concerns: string[] = [];
  if (summary.paused > 0) {
    concerns.push(`${summary.paused} token${summary.paused === 1 ? "" : "s"} paused`);
  }
  if (summary.feedsStale > 0) {
    concerns.push(`${summary.feedsStale} price feed${summary.feedsStale === 1 ? "" : "s"} stale`);
  }
  if (summary.withPendingMultiplier > 0) {
    concerns.push(`${summary.withPendingMultiplier} split${summary.withPendingMultiplier === 1 ? "" : "s"} pending`);
  }
  if (concerns.length > 0) {
    return { tone: "warn", title: "Worth a look", detail: concerns.join(" · ") };
  }
  if (!control || summary.lastStateAt === null) {
    return { tone: "neutral", title: "First checks in progress", detail: "The daemon has not finished its first pass." };
  }
  if (olderThan(summary.lastStateAt, STATE_LATE_MS)) {
    return { tone: "warn", title: "Checks running late", detail: `Token state was last read ${ago(summary.lastStateAt)}; the figures below are that old.` };
  }
  return { tone: "good", title: "All checks passing", detail: `Every listed Stock Token verified, priced and transferable, as of ${ago(summary.lastStateAt)}.` };
}

const TEXT_TONE: Record<Tone, string> = {
  good: "text-hood-deep",
  warn: "text-amber-700",
  bad: "text-red-700",
  neutral: "text-ink-soft",
};

const BADGE_TONE: Record<Tone, string> = {
  good: "bg-hood-wash text-hood-deep",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-red-50 text-red-700",
  neutral: "bg-panel text-ink-soft",
};

const BANNER_TONE: Record<Tone, string> = {
  good: "border-hood/40 bg-hood-wash",
  warn: "border-amber-200 bg-amber-50",
  bad: "border-red-200 bg-red-50",
  neutral: "border-line bg-panel",
};

const DOT_TONE: Record<Tone, string> = {
  good: "bg-hood",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  neutral: "bg-ink-faint",
};

function ledgerText(ledger: LedgerProgress): string {
  if (ledger.block === null) {
    return "holder ledger not started";
  }
  if (ledger.behind === null) {
    return `holder ledger at block ${ledger.block.toLocaleString("en-US")}, head not read`;
  }
  if (ledger.behind > BigInt(10_000)) {
    return `holder ledger reading history, block ${ledger.block.toLocaleString("en-US")}`;
  }
  return "holder ledger at head";
}

function chainText(health: ChainHealthRow | null): string {
  if (!health) {
    return "chain not read yet";
  }
  const parts = [`block ${health.headBlock.toLocaleString("en-US")}`, `${health.blockTimeMs ?? "?"} ms blocks`];
  if (health.confirmedAgeSeconds !== null) {
    parts.push(`L1 finality ${(health.confirmedAgeSeconds / 86_400).toFixed(1)} d`);
  }
  return parts.join(" · ");
}

export function AuthorityStrip(props: AuthorityStripProps) {
  const { summary, control, health, ledger, layout = "row" } = props;
  const state = verdict(props);
  const cards = metrics(props);
  const columns = layout === "rail" ? 2 : 3;
  return (
    <section className={`overflow-hidden rounded-card border border-line bg-raised ${layout === "rail" ? "" : "mt-8"}`}>
      <div className={`flex items-start gap-3 border-b px-5 py-3 ${BANNER_TONE[state.tone]}`}>
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT_TONE[state.tone]}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className={`text-[14px] font-medium ${TEXT_TONE[state.tone]}`}>{state.title}</p>
          <p className="text-[12.5px] leading-5 text-ink-soft">{state.detail}</p>
        </div>
        <span className="ml-auto hidden shrink-0 items-center gap-1 self-center sm:inline-flex">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">security verdict</span>
          <InfoTip
            align="end"
            text="Red when the issuer's registry is paused, the chain reports an incident, or a listed token fails verification. Amber for paused tokens, stale price feeds or pending splits. Green when every check that can fail passes."
          />
        </span>
      </div>
      <dl className={`grid gap-px bg-line ${columns === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
        {cards.map(function renderMetric(metric, index) {
          const align = (index + 1) % columns === 0 ? "end" : "start";
          return (
            <div key={metric.label} className="min-w-0 bg-raised px-4 py-3">
              <dt className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
                <span className="min-w-0">{metric.label}</span>
                <InfoTip text={metric.mechanism} align={align} />
              </dt>
              <dd className="mt-1">
                <span className={`block break-words text-[15px] font-medium tabular-nums ${TEXT_TONE[metric.tone]}`}>
                  {metric.href ? (
                    <Link href={metric.href} className="underline-offset-4 hover:underline">
                      {metric.value}
                    </Link>
                  ) : (
                    metric.value
                  )}
                </span>
                <span className={`mt-1 inline-block max-w-full truncate rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${BADGE_TONE[metric.tone]}`} title={metric.badge}>{metric.badge}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-5 py-2.5 font-mono text-[11px] text-ink-faint">
        <span>{chainText(health)}</span>
        <span>{ledgerText(ledger)}</span>
        <span>state read {ago(summary.lastStateAt)}</span>
        {control ? <span>registry {shortHex(control.registryAddress, 6, 4)} read {ago(control.checkedAt)}</span> : null}
      </div>
    </section>
  );
}
