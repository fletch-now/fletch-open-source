import { publicDiagnostic } from "@/lib/public-copy";
import type { ReactElement } from "react";
import type { Metric } from "@/lib/registry/token-markets-types";
import { ago } from "@/components/registry/format";
import { InfoTip } from "@/components/registry/info-tip";
import { LiveAge, LiveValue, ReadingExpiry } from "./live-reading";

export function marketNumber(value: number | null, dollars = true): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  if (!dollars) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (value > 0 && value < 0.01) return `$${value.toPrecision(3)}`;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function tokenSupply(raw: string | null, decimals: number | null): string {
  if (raw === null || decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return "Unavailable";
  if (!/^\d+(?:\.0+)?$/.test(raw)) return "Unavailable";
  const digits = raw.split(".")[0].padStart(decimals + 1, "0");
  const whole = decimals === 0 ? digits : digits.slice(0, -decimals);
  const fraction = decimals === 0 ? "" : digits.slice(-decimals).replace(/0+$/, "");
  return `${BigInt(whole).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

export function metricReason(reason: string): string {
  const reasons: Record<string, string> = {
    incomplete_24h_swap_coverage: "The indexed swaps do not yet cover a complete 24-hour window.",
    historical_quote_unavailable: "The historical USD quote is unavailable for this window.",
    unsupported_quote_currency: "This quote currency has no supported USD valuation.",
    stale_swap_index: "The swap index has not caught up to a current reading.",
  };
  return reasons[reason] ?? publicDiagnostic(reason);
}

export function volumeBasis(source: string | null): string | null {
  if (source?.includes("USDG denomination") || source?.includes("USDG notional")) return "USDG notional";
  if (source?.includes("Historical window-start Chainlink")) return "historical oracle estimate";
  return null;
}

interface TokenMetricProps {
  metric: Pick<Metric<number | string>, "value" | "source" | "asOf" | "reason"> & Partial<Pick<Metric<number | string>, "observation">>;
  displayValue?: string;
  dollars?: boolean;
  volume?: boolean;
  compact?: boolean;
}

function sourceLabel(source: string): string {
  if (source.startsWith("Robinscan reported")) return "Robinscan · fetch time";
  if (/^(Blockscout|Chain explorer)/i.test(source)) return "Explorer fetch time";
  if (source.startsWith("Complete ERC-20 Transfer")) return "RPC holder snapshot";
  if (source.startsWith("Outstanding ERC-20 supply")) return "Supply × DEX price";
  if (source.includes("USDG denomination")) return "Swap logs · USDG notional";
  if (source.includes("Historical window-start Chainlink")) return "Swap logs · historical feed";
  if (source.startsWith("Selected pool") || source.startsWith("Swap events in selected pool") || source.startsWith("Distinct transactions in selected pool")) return "Swap logs";
  if (source.startsWith("Pinned RPC bytecode")) return "RPC token metadata";
  if (source.startsWith("Pinned ERC-20")) return "RPC token contract";
  if (source.startsWith("Pinned RPC")) return "RPC pool state";
  if (source.startsWith("Pool spot price")) return "Pool state + quote conversion";
  const label = publicDiagnostic(source);
  return label.length <= 60 ? label : "Recorded source";
}

export function TokenMetric({ metric, dollars = true, displayValue, volume = false, compact = false }: TokenMetricProps): ReactElement {
  const value = typeof metric.value === "string" ? metric.value : marketNumber(metric.value, dollars);
  const basis = (volume || !compact) && metric.value !== null ? volumeBasis(metric.source) : null;
  const date = metric.asOf ? new Date(metric.asOf) : null;
  const validDate = date && Number.isFinite(date.getTime()) ? date : null;
  const reason = metric.reason ? metricReason(metric.reason) : null;
  const source = metric.source ? sourceLabel(metric.source) : "Source unavailable";
  const explanation = [publicDiagnostic(metric.source ?? "Source unavailable"), reason, validDate ? `Read at ${validDate.toISOString()}` : "Read time unavailable"].filter(Boolean).join("\n\n");
  return (
    <div className={`min-w-0 ${compact ? "registry-token-metric" : ""}`}>
      <p className={`${compact ? "registry-token-metric-value" : "[overflow-wrap:anywhere]"} font-mono text-[14px] tabular-nums text-ink`}><LiveValue value={metric.value === null ? "Unavailable" : displayValue ?? value} expiresAt={metric.observation?.expiresAt} /></p>
      {basis && !compact && !source.toLowerCase().includes(basis.toLowerCase()) ? <p className="mt-1 text-[12px] leading-5 text-ink">{basis}</p> : null}
      {compact ? <div className="registry-metric-source mt-1 flex justify-end text-[12px] leading-5">
        <InfoTip text={explanation} label={`Source and reading details: ${source}`} triggerText={source} align="end" />
      </div> : <p className="mt-1 text-[12px] leading-5 text-ink-soft">{source}</p>}
      <p className="text-[12px] leading-5 text-ink">{validDate ? <LiveAge at={validDate.toISOString()} initialLabel={ago(validDate)} /> : "Read time unavailable"}</p>
      {!compact ? <>
        <ReadingExpiry expiresAt={metric.observation?.expiresAt} stale={metric.observation?.status === "stale"} />
        <details className="mt-2 text-[12px] leading-5 text-ink-soft">
          <summary className="cursor-pointer text-ink focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4">{reason && metric.value === null ? "Why unavailable" : "Source and method"}</summary>
          <p className="mt-2 [overflow-wrap:anywhere]">{publicDiagnostic(metric.source ?? "Source unavailable")}</p>
          {reason ? <p className="mt-2 [overflow-wrap:anywhere]">{reason}</p> : null}
          {validDate ? <p className="mt-2">Recorded at <time dateTime={validDate.toISOString()}>{validDate.toISOString()}</time>.</p> : null}
        </details>
      </> : null}
    </div>
  );
}
