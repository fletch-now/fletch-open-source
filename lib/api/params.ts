// Query and path parameters shared by the public read routes. A missing or
// malformed value reads as the default rather than a 400, so a caller that
// never heard of a parameter sees the response it always did; a value past
// the ceiling is clamped, never passed through.

export function parseOffset(value: string | null): number {
  const offset = Number(value ?? 0);
  return Number.isInteger(offset) && offset > 0 ? offset : 0;
}

// `Number("abc")` is NaN, and NaN survives Math.min and Math.max, which is how
// an unchecked `limit` once ran without any LIMIT clause; a fractional value
// is truncated because Postgres refuses a non-integer LIMIT.
export function parseLimit(value: string | null, fallback: number, max: number): number {
  if (value === null) {
    return fallback;
  }
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit < 1) {
    return fallback;
  }
  return Math.min(Math.trunc(limit), max);
}

// Next hands path segments already decoded, so a symbol is matched as it
// arrives; anything outside the ticker alphabet cannot name an asset.
const SYMBOL_PATTERN = /^[A-Z0-9.$-]{1,16}$/;

export function parseSymbolParam(value: string): string | null {
  const symbol = value.toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

// `request.json()` ignores Content-Type, so without this a `text/plain` POST,
// which a browser sends with no preflight, would be parsed as a write.
export function hasJsonBody(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  return type.toLowerCase().startsWith("application/json");
}
