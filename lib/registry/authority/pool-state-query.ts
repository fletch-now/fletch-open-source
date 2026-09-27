import { sql } from "drizzle-orm";
import { dexPools } from "@/lib/db/schema";
import type { PoolQuoteObservation } from "../token-markets-types";

// A quote belongs only to the mirrored state and canonical factory identity
// that produced it. Independent legacy reads must not borrow another snapshot.
const sameStateValues = sql`pp.chain_id=${dexPools.chainId} and pp.pool_id=${dexPools.id}
  and pp.observed_at=${dexPools.stateCheckedAt} at time zone 'UTC'
  and pp.price_usd is not distinct from ${dexPools.priceUsd}
  and pp.depth_usd is not distinct from ${dexPools.depthUsd}`;

const matchingFactory = sql`pp.factory_created_block=${dexPools.createdBlock}
  and pp.factory_created_hash is not distinct from ${dexPools.createdBlockHash}`;
export const matchingPrioritySnapshot = sql`${sameStateValues} and ${matchingFactory}`;

export const poolQuoteObservation = sql<PoolQuoteObservation | null>`(
  select pp.quote_observation from registry_priority_pools pp where ${matchingPrioritySnapshot}
)`;

export const poolStateCurrent = sql`coalesce(
  ${dexPools.stateCheckedAt} between now()-interval '3 minutes' and now()
  and not exists(select 1 from registry_priority_pools pp where ${sameStateValues}
    and (not(${matchingFactory}) or pp.reason is not null or pp.quote_observation is not null and not coalesce(
      (pp.quote_observation->>'expiresAt')::timestamptz>=now()
      and (pp.quote_observation->>'fetchedAt')::timestamptz<=now()
      and (pp.quote_observation->>'sourceAt' is null and pp.quote_observation->>'method'='fixed_notional_usdg'
        or (pp.quote_observation->>'sourceAt')::timestamptz<=now())
      and pp.quote_observation->>'value' is not null and pp.quote_observation->>'reason' is null,false))),false)`;
