import { tokenCardMetric } from "@/lib/og-metrics";
import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og";
import { trustForToken } from "@/lib/registry/trust";
import { RH_MAINNET_ID } from "@/lib/config";

export const revalidate = 60;
export const alt = "Token address and provenance on Robinhood Chain · Fletch";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return new Response("Invalid token address", { status: 404 });
  }
  const trust = await trustForToken(RH_MAINNET_ID, address.toLowerCase());
  // On-chain names are arbitrary input: a short fixed heading keeps hostile or
  // very long metadata from overflowing the card or impersonating site copy.
  return brandCard({ title: "Check the\ntoken address.", subtitle: `${trust.label} · Robinhood Chain`, metric: await tokenCardMetric(address.toLowerCase()) });
}
