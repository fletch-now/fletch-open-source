import assert from "node:assert/strict";
import { test } from "node:test";
import { groupChangelog } from "./changelog-groups";
import type { AuthorityEvent } from "./authority/read";

function event(index: number, overrides: Partial<AuthorityEvent> = {}): AuthorityEvent {
  return { id: `e${index}`, chainId: 4663, kind: "dex.pool_new", assetId: "glxy", address: "manager", symbol: "GLXY", title: "New GLXY pool", detail: {}, blockNumber: null, txHash: null, occurredAt: new Date(index * 60_000), observedAt: new Date(index * 60_000), matchedAt: null, ...overrides };
}

test("pool bursts collapse without losing observations or singular listings", function groups() {
  const burst = Array.from({ length: 14 }, (_, index) => event(index));
  const listing = event(8, { id: "listing", kind: "listing.changed", symbol: "FRONG", assetId: null });
  const other = event(9, { id: "other", assetId: "tsla", symbol: "TSLA" });
  const older = event(-40);
  const grouped = groupChangelog([...burst, listing, other, older]);
  assert.equal(grouped.length, 4);
  assert.equal(grouped[0].members.length, 14);
  assert.equal(grouped.find((group) => group.event.id === "listing")?.members.length, 1);
  assert.equal(grouped.flatMap((group) => group.members).length, 17);
});
