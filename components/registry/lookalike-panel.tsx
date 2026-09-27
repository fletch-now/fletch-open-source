import { ago } from "@/components/registry/format";
import { TableShell } from "@/components/registry/table-shell";
import Link from "@/components/ui/navigation-link";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import type { Lookalike } from "@/lib/registry/authority/read";
import { TrustBadge } from "@/components/registry/trust-badge";
import { lookalikeReason } from "@/components/registry/lookalike-reason";
import { trustForTokens } from "@/lib/registry/trust";

interface LookalikePanelProps {
  symbol: string;
  chainId: number;
  canonicalAddress: string;
  lookalikes: Lookalike[];
  // Whether the scan has run at all; before it has, "none" would be a guess.
  scanned: boolean;
}

export async function LookalikePanel({ symbol, chainId, canonicalAddress, lookalikes, scanned }: LookalikePanelProps): Promise<React.ReactElement> {
  const trust = await trustForTokens(chainId, lookalikes.map((row) => row.address));
  return (
    <section id="lookalikes" className="mt-14 scroll-mt-24">
      <h2 className="text-[18px] font-medium text-ink">Lookalike tokens</h2>
      <p className="mt-1 max-w-2xl text-[13.5px] leading-6 text-ink-soft">
        Recorded tokens with a matching name or ticker. The published listing for {symbol} uses
        {" "}<span className="break-all font-mono">{canonicalAddress}</span>. A name match alone does not establish
        issuer backing or intent. Explorer discovery and recorded contract checks may be incomplete.{" "}
        <Link href={`/registry/lookalikes?q=${encodeURIComponent(symbol)}`} className="underline underline-offset-4 hover:text-ink">
          Browse all recorded matches
        </Link>.
      </p>
      {!scanned ? (
        <p className="mt-4 rounded-card border border-dashed border-line bg-panel/40 px-5 py-6 text-[14px] text-ink-soft">
          The lookalike scan has not run yet.
        </p>
      ) : lookalikes.length === 0 ? (
        <p className="mt-4 rounded-card border border-dashed border-line bg-panel/40 px-5 py-6 text-[14px] text-ink-soft">
          No matching token is recorded for {symbol}. Discovery may not have reached every contract.
        </p>
      ) : (
        <TableShell label="Lookalike Panel" className="mt-4">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">
                <th className="px-4 py-3 font-medium">Token</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lookalikes.map(function renderRow(row) {
                const verdict = trust.get(row.address);
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-[13.5px] text-ink">
                      <span className="font-mono">{row.symbol ?? "?"}</span>
                      <span className="ml-2 text-ink-soft">{row.name ?? ""}</span>
                    </td>
                    <td className="max-w-[260px] break-all px-4 py-3 font-mono text-[12px] text-ink-soft">
                      <a href={explorerAddressUrl(chainId, row.address)} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
                        {row.address}
                      </a>
                      <p className="mt-1 text-[12px]">Last recorded {ago(row.lastSeenAt)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <TrustBadge level={verdict?.level ?? "unknown"} detail={verdict?.detail} />
                      <p className="mt-2 max-w-xs text-[12px] leading-5 text-ink-soft">{lookalikeReason(row)}</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      )}
    </section>
  );
}
