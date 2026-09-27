import { pool } from "@/lib/db";
import { BlockscoutUnavailableError, type BlockscoutAccounting } from "./authority/blockscout";

export const EXPLORER_REQUESTS_PER_DAY = 50_000;
export const EXPLORER_PROVIDER_KEY = "registry.blockscout";

export interface ExplorerProviderReading {
  observedAt: string;
  httpStatus: number;
  creditsRemaining: number | null;
  requestsPerSecond: number | null;
}

function headerNumber(response: Response, name: string): number | null {
  const value = response.headers.get(name);
  if (value === null || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function explorerProviderReading(response: Response): ExplorerProviderReading {
  return { observedAt: new Date().toISOString(), httpStatus: response.status,
    creditsRemaining: headerNumber(response, "x-credits-remaining"), requestsPerSecond: headerNumber(response, "x-ratelimit-limit") };
}

export const explorerAccounting: BlockscoutAccounting = {
  async beforeRequest(): Promise<void> {
    const result = await pool.query<{ count: number }>(`insert into rate_counters(bucket,count,window_start)
      values('blockscout:day',1,now()) on conflict(bucket) do update set
      count=case when rate_counters.window_start <= now()-interval '1 day' then 1 else rate_counters.count+1 end,
      window_start=case when rate_counters.window_start <= now()-interval '1 day' then now() else rate_counters.window_start end returning count`);
    if (result.rows[0].count > EXPLORER_REQUESTS_PER_DAY) throw new BlockscoutUnavailableError("Explorer daily request allowance reached; previous observations retained");
  },
  async afterResponse(response: Response): Promise<void> {
    const reading = explorerProviderReading(response);
    await pool.query(`insert into app_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value
      where app_settings.value::jsonb->>'observedAt' <= excluded.value::jsonb->>'observedAt'`, [EXPLORER_PROVIDER_KEY, JSON.stringify(reading)]);
  },
};
