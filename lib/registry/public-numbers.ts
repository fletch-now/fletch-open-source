import { eq, max } from "drizzle-orm";
import { RH_MAINNET_ID } from "@/lib/config";
import { db } from "@/lib/db";
import { authorityEvents, registryAssetState } from "@/lib/db/schema";
import { publicReadCache } from "@/lib/public-cache";
import { browseSummary } from "@/lib/registry/browse";
import { registryVerdict, type RegistryVerdict } from "@/lib/registry/authority/freshness";
import { authorityEventCounts, authoritySummary, lookalikeTotals } from "@/lib/registry/authority/read";
import { lastOkRunOf } from "@/lib/registry/authority/runs";
import { verifiedAssetIndex } from "@/lib/registry/trust";

export interface PublicRegistryNumbers {
  assets: number;
  verified: number;
  canonical: number;
  feedsRead: number;
  lookalikes: number;
  changesThisWeek: number;
  verdict: RegistryVerdict["verdict"];
  summary: string;
  checkedAt: Date;
  observedAt: {
    listings: Date | null;
    canonical: Date | null;
    feeds: Date | null;
    lookalikeScan: Date | null;
    changes: Date | null;
  };
}

export interface RegistryNumberStat {
  value: string;
  label: string;
}

const cachedNumbers = publicReadCache<PublicRegistryNumbers>(10_000, 1);

async function readNumbers(): Promise<PublicRegistryNumbers> {
  const [listing, authority, matches, events, verdict, verified, stateTimes, eventTimes, lookalikeRun] = await Promise.all([
    browseSummary(RH_MAINNET_ID),
    authoritySummary(RH_MAINNET_ID),
    lookalikeTotals(RH_MAINNET_ID),
    authorityEventCounts(RH_MAINNET_ID, 7),
    registryVerdict(RH_MAINNET_ID),
    verifiedAssetIndex(RH_MAINNET_ID),
    db.select({ canonical: max(registryAssetState.canonicalCheckedAt), feeds: max(registryAssetState.feedCheckedAt) })
      .from(registryAssetState).where(eq(registryAssetState.chainId, RH_MAINNET_ID)),
    db.select({ at: max(authorityEvents.observedAt) }).from(authorityEvents).where(eq(authorityEvents.chainId, RH_MAINNET_ID)),
    lastOkRunOf("lookalikes"),
  ]);
  return {
    assets: listing.total,
    verified: verified.length,
    canonical: authority.canonical,
    feedsRead: authority.feedsRead,
    lookalikes: matches.total,
    changesThisWeek: events.reduce((sum, entry) => sum + entry.count, 0),
    verdict: verdict.verdict,
    summary: verdict.summary,
    checkedAt: verdict.checkedAt,
    observedAt: {
      listings: listing.lastObservedAt,
      canonical: stateTimes[0]?.canonical ?? null,
      feeds: stateTimes[0]?.feeds ?? null,
      lookalikeScan: lookalikeRun?.finishedAt ?? null,
      changes: eventTimes[0]?.at ?? null,
    },
  };
}

// Catch outside the cache so unavailable data is retried on the next request.
export async function readPublicRegistryNumbers(): Promise<PublicRegistryNumbers | null> {
  try {
    return await cachedNumbers(String(RH_MAINNET_ID), readNumbers);
  } catch {
    return null;
  }
}

export function registryNumberStats(numbers: PublicRegistryNumbers | null): readonly RegistryNumberStat[] {
  function count(value: number | undefined): string {
    return value === undefined ? "—" : value.toLocaleString("en-US");
  }
  return [
    { value: count(numbers?.verified), label: "verified listings" },
    { value: count(numbers?.canonical), label: "records with a canonical beacon" },
    { value: count(numbers?.feedsRead), label: "assets with a feed reading" },
    { value: count(numbers?.lookalikes), label: "recorded scan matches" },
    { value: count(numbers?.changesThisWeek), label: "changes observed in 7 days" },
    { value: numbers?.verdict ?? "—", label: "registry status, self-reported" },
  ];
}
