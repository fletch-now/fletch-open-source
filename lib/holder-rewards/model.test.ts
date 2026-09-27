import assert from "node:assert/strict";
import { test } from "node:test";
import { activationProblem, EMPTY_HOLDER_POLICY, HolderPolicySchema, holdingValue, rewardPeriod } from "./model";

test("eligibility uses exact raw units, never rounded display values", () => {
  assert.deepEqual(holdingValue("100000000000000000000", 18, "1"), { qualifies: false, valueUsd: "100.00" });
  assert.deepEqual(holdingValue("100000000000000000001", 18, "1"), { qualifies: true, valueUsd: "100.00" });
  assert.deepEqual(holdingValue("99999999999999999999", 18, "1"), { qualifies: false, valueUsd: "99.99" });
  assert.equal(holdingValue("25000000", 6, "4.00000000000000000001").qualifies, true);
  assert.equal(holdingValue("25000000", 6, "3.99999999999999999999").qualifies, false);
  assert.equal(holdingValue("0", 18, "900000").qualifies, false);
  assert.equal(holdingValue((BigInt(2) ** BigInt(256) - BigInt(1)).toString(), 36, "0.000000001").qualifies, true);
  for (const bad of ["NaN", "Infinity", "-1", "1e9", "", "0"]) assert.throws(() => holdingValue("1", 0, bad));
  assert.throws(() => holdingValue((BigInt(2) ** BigInt(256)).toString(), 18, "1"));
  assert.throws(() => holdingValue("10", 255, "1"));
  assert.throws(() => holdingValue("-10", 18, "1"));
});

test("unconfigured terms cannot activate and reward periods use UTC", () => {
  assert.ok(activationProblem(EMPTY_HOLDER_POLICY));
  const configured = { ...EMPTY_HOLDER_POLICY, chainId: 4663 as const, tokenAddress: `0x${"a".repeat(40)}`, referencePoolId: "pool", period: "once" as const };
  assert.ok(activationProblem(configured));
  assert.equal(activationProblem({ ...configured, immediateGrantAccepted: true }), null);
  assert.equal(HolderPolicySchema.safeParse({ ...configured, chainId: 1 }).success, false);
  assert.equal(HolderPolicySchema.safeParse({ ...configured, minDepthUsd: "24999" }).success, false);
  assert.equal(rewardPeriod(configured, new Date("2026-10-01T00:00:00Z")), "once");
  const endOfDay = new Date("2026-10-01T01:00:00+03:00");
  assert.equal(rewardPeriod({ ...configured, period: "utc_month" }, endOfDay), "2026-09");
  assert.equal(rewardPeriod({ ...configured, period: "utc_day" }, endOfDay), "2026-09-30");
});
