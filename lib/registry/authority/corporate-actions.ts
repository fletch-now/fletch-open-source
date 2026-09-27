// Robinhood's corporate-actions feed, kept as rows. Today every entry is a cash
// dividend that will be reinvested into the token's multiplier; the row is what
// lets a page say "a dividend of 0.91 is being processed for 10 September".

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { registryCorporateActions } from "@/lib/db/schema";
import { ROBINHOOD_CORPORATE_ACTIONS_ENDPOINT } from "@/lib/registry/authority/constants";
import { activeAssets } from "@/lib/registry/authority/assets";
import { emitEvents } from "@/lib/registry/authority/events";
import { lastOkRunOf, type RunOutcome } from "@/lib/registry/authority/runs";

interface ApiAction {
  id: string;
  type: string;
  status: string;
  tokenSymbol: string;
  processDate?: { year: number; month: number; day: number };
  details?: { cashDividend?: { rate?: string } };
}

function isoDay(date: ApiAction["processDate"]): string | null {
  if (!date) {
    return null;
  }
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

// "CORPORATE_ACTION_TYPE_CASH_DIVIDEND" -> "cash_dividend"; the API's prefix
// carries no information a row needs.
function shortKind(value: string, prefix: string): string {
  return value.replace(prefix, "").toLowerCase();
}

export async function syncCorporateActions(chainId: number): Promise<RunOutcome> {
  const response = await fetch(ROBINHOOD_CORPORATE_ACTIONS_ENDPOINT, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`corporate actions ${response.status}`);
  }
  const body = (await response.json()) as { corpActions?: ApiAction[] };
  const actions = body.corpActions ?? [];
  const assets = await activeAssets(chainId);
  const idBySymbol = new Map(assets.map((asset) => [asset.symbol, asset.id]));
  // The first sync records what stands; later syncs announce what is new.
  const announcing = (await lastOkRunOf("corporate-actions")) !== null;
  let upserted = 0;
  for (const action of actions) {
    const row = {
      id: action.id,
      symbol: action.tokenSymbol,
      assetId: idBySymbol.get(action.tokenSymbol) ?? null,
      kind: shortKind(action.type, "CORPORATE_ACTION_TYPE_"),
      status: shortKind(action.status, "CORPORATE_ACTION_STATUS_"),
      processDate: isoDay(action.processDate),
      rate: action.details?.cashDividend?.rate ?? null,
      payload: action as unknown as Record<string, unknown>,
    };
    const written = await db
      .insert(registryCorporateActions)
      .values(row)
      .onConflictDoUpdate({
        target: registryCorporateActions.id,
        set: { status: row.status, processDate: row.processDate, rate: row.rate, payload: row.payload, assetId: row.assetId, updatedAt: sql`now()` },
      })
      // xmax = 0 is Postgres's own word for "this row was inserted, not updated".
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    upserted += 1;
    if (written[0]?.inserted && announcing) {
      await emitEvents([
        {
          chainId,
          kind: "corporate.action",
          assetId: row.assetId,
          symbol: row.symbol,
          key: row.id,
          detail: { actionId: row.id, actionType: row.kind, status: row.status, effectiveDate: row.processDate, rate: row.rate },
          occurredAt: row.processDate ? new Date(`${row.processDate}T00:00:00.000Z`) : new Date(),
        },
      ]);
    }
  }
  const inProgress = actions.filter((action) => action.status.endsWith("IN_PROGRESS")).length;
  return { rows: upserted, detail: { inProgress } };
}

export async function actionsForSymbol(symbol: string) {
  return db.select().from(registryCorporateActions).where(eq(registryCorporateActions.symbol, symbol)).orderBy(sql`${registryCorporateActions.processDate} desc nulls last`).limit(20);
}
