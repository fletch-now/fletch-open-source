import type { Metadata } from "next";
import { Suspense, type ReactElement } from "react";
import { MarketLoading } from "@/components/registry/market-loading";
import { publicPageMetadata } from "@/lib/seo";
import { TokenMarkets } from "@/components/registry/token-markets";
import { PoolMarkets } from "@/components/registry/pool-markets";

export const revalidate = 60;
export const metadata: Metadata = publicPageMetadata("/registry/markets");

export default async function MarketsPage({ searchParams }: PageProps<"/registry/markets">): Promise<ReactElement> {
  const params = await searchParams;
  return <Suspense fallback={<MarketLoading />}>{params.view === "pools" ? <PoolMarkets searchParams={Promise.resolve(params)} params={Promise.resolve({})} /> : <TokenMarkets params={params} />}</Suspense>;
}
