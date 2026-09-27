// The changelog cursor as a query parameter or Last-Event-ID. A value that
// does not parse is refused: a consumer whose stored cursor was corrupted or
// double-encoded must hear so, because the alternative, resuming from now,
// skips every event in between without a word.

import { parseEventCursor, type EventCursor } from "@/lib/registry/authority/read";

const EVENT_ID = /^ev_[0-9a-f]{24}$/;

export const CURSOR_ERROR = "cursor must be an ISO instant or `${observedAt}|${id}` as returned in nextCursor";

export interface CursorParam {
  cursor: EventCursor | null;
  error: string | null;
}

// The cursor as a client passes it back, the same string `nextCursor` and an
// SSE frame's id carry.
export function cursorText(cursor: EventCursor): string {
  return `${cursor.after.toISOString()}${cursor.afterId ? `|${cursor.afterId}` : ""}`;
}

export function parseCursorParam(value: string | null): CursorParam {
  if (value === null) {
    return { cursor: null, error: null };
  }
  const cursor = parseEventCursor(value);
  if (!cursor || (cursor.afterId !== null && !EVENT_ID.test(cursor.afterId))) {
    return { cursor: null, error: CURSOR_ERROR };
  }
  return { cursor, error: null };
}
