import { tokenCardMetric } from "@/lib/og-metrics";
import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og";
import { getAssetBySymbol } from "@/lib/registry/assets";
import { trustForToken } from "@/lib/registry/trust";
import { RH_MAINNET_ID } from "@/lib/config";

export const revalidate = 60;
export const alt = "Robinhood Chain token listing and provenance · Fletch";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const { symbol } = await params;
  const asset = await getAssetBySymbol(RH_MAINNET_ID, symbol.toUpperCase());
  if (!asset) {
    return new Response("Token not found", { status: 404 });
  }
  const trust = await trustForToken(RH_MAINNET_ID, asset.address);
  // Wide glyphs can overflow the card even when the character count is short.
  const symbolLabel = asset.symbol.length > 10 ? `${asset.symbol.slice(0, 10)}…` : asset.symbol;
  return brandCard({ title: `${symbolLabel}\non Robinhood Chain.`, subtitle: `${trust.label} · Token registry`, metric: await tokenCardMetric(asset.address, asset.id) });
}
