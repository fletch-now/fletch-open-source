// GET /api/v1/chains/:chainId/assets/:symbol/history — one row per UTC day of
// everything the registry publishes about an asset: multiplier, flags, feed
// and quote prices, DEX price and premium, supply and the counts beside them.
// `from`/`to` are UTC days (default the last 90), `at` returns that one day,
// `fields` narrows each row to the keys named. `coverage` says how many days
// are actually on record, so a 90-day window over two days of rows says two.
//
// Every parameter is validated before the window is built: a caller who asks
// for a window the route does not honour gets a 400 saying so rather than a
// 200 carrying a different window.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { parseSymbolParam } from "@/lib/api/params";
import { getAssetBySymbol } from "@/lib/registry/assets";
import { historyCoverage, historyFor, stateOn, utcDay, windowEndingOn, type HistoryWindow } from "@/lib/registry/authority/state-daily";
import { publicStateDay, STATE_DAY_FIELDS } from "@/lib/registry/authority/shape";

export { preflight as OPTIONS } from "@/lib/api/etag";

const DEFAULT_DAYS = 90;
const MAX_DAYS = 3_650;

// The day's row is rewritten by every run of the hourly job, so the answer for
// today is only good until the next one.
const MAX_AGE_SECONDS = 3_600;

function isDay(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isWindowLength(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= MAX_DAYS;
}

function pick(row: Record<string, unknown>, fields: Set<string>): Record<string, unknown> {
  const picked: Record<string, unknown> = { day: row.day };
  for (const field of fields) {
    picked[field] = row[field];
  }
  return picked;
}

interface WindowParams {
  from: string | null;
  to: string | null;
  days: string | null;
}

function windowFrom(params: WindowParams): HistoryWindow {
  const to = params.to ?? utcDay(new Date());
  if (params.from !== null) {
    return { from: params.from, to };
  }
  return windowEndingOn(to, params.days === null ? DEFAULT_DAYS : Number(params.days));
}

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/assets/[symbol]/history">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }
  const { chainId: chainIdParam, symbol } = await ctx.params;
  const chainId = Number(chainIdParam);
  if (chainId !== RH_MAINNET_ID) {
    return publicJson(404, { error: "Asset not found" });
  }
  const ticker = parseSymbolParam(symbol);
  const asset = ticker ? await getAssetBySymbol(chainId, ticker) : null;
  if (!asset) {
    return publicJson(404, { error: "Asset not found" });
  }
  const params = new URL(request.url).searchParams;
  const at = params.get("at");
  const from = params.get("from");
  const to = params.get("to");
  const length = params.get("days");
  if (at !== null && !isDay(at)) {
    return publicJson(400, { error: "at must be a UTC day, YYYY-MM-DD" });
  }
  if (from !== null && !isDay(from)) {
    return publicJson(400, { error: "from must be a UTC day, YYYY-MM-DD" });
  }
  if (to !== null && !isDay(to)) {
    return publicJson(400, { error: "to must be a UTC day, YYYY-MM-DD" });
  }
  if (length !== null && !isWindowLength(length)) {
    return publicJson(400, { error: `days must be a whole number of days, 1 to ${MAX_DAYS}` });
  }
  const window = at === null ? windowFrom({ from, to, days: length }) : { from: at, to: at };
  if (window.from > window.to) {
    return publicJson(400, { error: `from must not be after to: ${window.from} is after ${window.to}` });
  }
  const requestedFields = (params.get("fields") ?? "").split(",").map((field) => field.trim()).filter(Boolean);
  const unknown = requestedFields.filter((field) => !STATE_DAY_FIELDS.includes(field));
  if (unknown.length > 0) {
    return publicJson(400, { error: `Unknown fields: ${unknown.join(", ")}. Known: ${STATE_DAY_FIELDS.join(", ")}` });
  }
  const [rows, coverage] = await Promise.all([
    at === null ? historyFor(asset.id, window) : stateOn(asset.id, at).then((row) => (row ? [row] : [])),
    historyCoverage(asset.id),
  ]);
  const fields = new Set(requestedFields);
  const days = rows.map(publicStateDay).map((row) => (fields.size > 0 ? pick(row, fields) : row));
  return cachedJson(
    request,
    {
      chainId,
      symbol: asset.symbol,
      // `totalSupplyRaw` is in the token's own units, and nothing else in the
      // body says how many that is, so a stored response could not be read
      // back without a second call for the asset.
      decimals: asset.decimals,
      from: window.from,
      to: window.to,
      // The daily job started with this build, so early windows are short by
      // design rather than by a gap in the data.
      coverage: { daysOnRecord: coverage.days, firstDay: coverage.firstDay, latestDay: coverage.latestDay },
      days,
    },
    MAX_AGE_SECONDS,
  );
}
