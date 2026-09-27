
export const POOL_STATE_FRESH_MS = 3 * 60_000;

export function stateReadIsCurrent(at: Date | null | undefined, now = Date.now()): boolean {
  if (!at) return false;
  const age = now - at.getTime();
  return Number.isFinite(age) && age >= 0 && age <= POOL_STATE_FRESH_MS;
}

export function positivePoolPrice(value: string | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
