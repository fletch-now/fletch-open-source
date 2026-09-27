import { TableShell } from "@/components/registry/table-shell";
import { explorerTxUrl } from "@/lib/chain/explorer";
import type { BridgeEscrowRow, BridgeFlow } from "@/lib/registry/authority/bridge";
import { ago, shortHex, supplyText } from "@/components/registry/format";

interface BridgePanelProps {
  symbol: string;
  chainId: number;
  decimals: number;
  flows: BridgeFlow[];
  escrow: BridgeEscrowRow | null;
}

// Claimability is a fact about the flow, decided here rather than in render.
function claimText(flow: BridgeFlow): string {
  if (!flow.claimableAt) {
    return "—";
  }
  return flow.claimableAt.getTime() <= Date.now() ? "window passed" : `after ${flow.claimableAt.toISOString().slice(0, 10)}`;
}

export function BridgePanel({ symbol, chainId, decimals, flows, escrow }: BridgePanelProps) {
  const inFlight = escrow?.inFlightRaw ? BigInt(escrow.inFlightRaw.split(".")[0]) : null;
  return (
    <section id="bridge" className="mt-14 scroll-mt-24">
      <h2 className="text-[18px] font-medium text-ink">Bridge</h2>
      <p className="mt-1 max-w-2xl text-[13.5px] leading-6 text-ink-soft">
        {symbol} reaches Robinhood Chain through the Arbitrum token bridge: the L1 gateway escrows the Ethereum token and the L2
        contract mints against it. Escrow above L2 supply is value in flight, either a deposit not yet finalised or a withdrawal
        burned here and not yet claimed on Ethereum after its seven-day window.{" "}
        <a href={`/api/v1/chains/${chainId}/bridge?symbol=${encodeURIComponent(symbol)}`} className="underline underline-offset-4 hover:text-ink">
          Bridge as JSON
        </a>
        .
      </p>
      {escrow ? (
        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4">
          {[
            { label: "escrowed on L1", value: supplyText(escrow.escrowRaw.split(".")[0], decimals) },
            { label: "supply on L2", value: escrow.l2SupplyRaw ? supplyText(escrow.l2SupplyRaw.split(".")[0], decimals) : "—" },
            { label: "in flight", value: inFlight === null ? "—" : `${inFlight < BigInt(0) ? "−" : ""}${supplyText((inFlight < BigInt(0) ? -inFlight : inFlight).toString(), decimals)}` },
            { label: "checked", value: ago(escrow.checkedAt) },
          ].map(function renderFact(fact) {
            return (
              <div key={fact.label} className="bg-raised px-4 py-3">
                <dt className="mono-label">{fact.label}</dt>
                <dd className="mt-1 font-mono text-[14px] tabular-nums text-ink">{fact.value}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="mt-4 text-[13px] text-ink-faint">Escrow not read yet.</p>
      )}
      {flows.length > 0 ? (
        <TableShell label="Bridge Panel" className="mt-4">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Direction</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Counterparty</th>
                <th className="px-4 py-3 font-medium">Claimable</th>
                <th className="px-4 py-3 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {flows.map(function renderFlow(flow) {
                const claimable = claimText(flow);
                return (
                  <tr key={flow.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-ink-faint">{ago(flow.occurredAt)}</td>
                    <td className="px-4 py-2.5 text-[12.5px]">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${flow.direction === "deposit" ? "bg-hood-wash text-hood-deep" : "bg-amber-50 text-amber-800"}`}>{flow.direction}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink">{supplyText(flow.amountRaw.split(".")[0], decimals)}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ink-soft">{shortHex(flow.direction === "deposit" ? flow.toAddress : flow.fromAddress, 8, 6)}</td>
                    <td className="px-4 py-2.5 text-[12px] text-ink-soft">{claimable}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px]">
                      <a href={explorerTxUrl(chainId, flow.txHash)} target="_blank" rel="noreferrer" className="text-ink-faint underline-offset-4 hover:underline">
                        {shortHex(flow.txHash)}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      ) : (
        <p className="mt-4 text-[13px] text-ink-faint">No deposits or withdrawals recorded yet.</p>
      )}
    </section>
  );
}
