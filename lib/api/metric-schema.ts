import type { MarketSelection, MetricObservation, PoolQuoteObservation } from "@/lib/registry/token-markets-types";

const NullableTime = { type: ["string", "null"], format: "date-time" } as const;
const ObservationStatus = { type: "string", enum: ["current", "stale", "missing", "invalid"] } as const;

const observationProperties = {
  sourceId: { type: ["string", "null"], description: "Stable source kind and identity; null when the stored source has no structured identity." },
  blockNumber: { type: ["string", "null"], pattern: "^[0-9]+$" }, blockHash: { type: ["string", "null"] },
  sourceAt: { ...NullableTime, description: "Source moment, usually the pinned block timestamp. Unknown for explorer snapshots." },
  fetchedAt: { ...NullableTime, description: "Recorded fetch/publication time. Null when older observations did not record it separately." },
  expiresAt: { ...NullableTime, description: "Inclusive hard freshness boundary. A derived value expires with its earliest-expiring required input." },
  method: { type: "string" },
  parameters: { type: "object", additionalProperties: { type: ["string", "number", "boolean", "null"] }, description: "Structured computation parameters, including historical quote sampling/oracle times and valuation assumptions when recorded." },
  inputs: { type: "array", items: { type: "object", properties: {
    name: { type: "string" }, value: { type: ["number", "string", "null"] }, asOf: NullableTime,
    observation: { $ref: "#/components/schemas/MetricObservation" },
  }, required: ["name", "value", "asOf", "observation"] } },
  coverage: { type: "object", properties: {
    status: { type: "string", enum: ["complete", "partial", "unknown"] }, scope: { type: "string" },
    windowStartAt: NullableTime, windowEndAt: NullableTime,
  }, required: ["status", "scope", "windowStartAt", "windowEndAt"] },
  status: { ...ObservationStatus, description: "Timestamp validity and freshness, separate from read success and coverage." },
  readStatus: { type: "string", enum: ["ok", "partial", "failed", "unread"], description: "A retained current observation may coexist with a failed latest refresh." },
} as const satisfies Record<keyof MetricObservation, unknown>;

export const MetricObservationSchema = { type: "object", properties: observationProperties, required: Object.keys(observationProperties) } as const;

const selectionProperties = {
  selectedAt: NullableTime, expiresAt: NullableTime,
  policy: { type: "string", description: "Versioned bounded selection: issuer listing, otherwise V3 quote holdings at least $10,000, otherwise V4 bounded 1% estimate at least $100. No issuer verification is inferred from economics." },
  status: ObservationStatus,
} as const satisfies Record<keyof MarketSelection, unknown>;

export const MarketSelectionSchema = { type: "object", properties: selectionProperties, required: Object.keys(selectionProperties),
  description: "Recorded bounded universe comparison; expires after fifteen minutes. A stale selection withholds dominantAddress while retaining its explanation and observation time." } as const;

const quoteProperties = {
  value: { type: ["number", "null"] }, source: { type: ["string", "null"] }, reason: { type: ["string", "null"] },
  sourceId: observationProperties.sourceId, sourceAt: NullableTime, fetchedAt: NullableTime, expiresAt: NullableTime,
  blockNumber: observationProperties.blockNumber, blockHash: observationProperties.blockHash,
  method: observationProperties.method, parameters: observationProperties.parameters,
} as const satisfies Record<keyof PoolQuoteObservation, unknown>;

export const PoolQuoteObservationSchema = { type: ["object", "null"], properties: quoteProperties, required: Object.keys(quoteProperties),
  description: "Quote conversion captured with the pool snapshot. Null for older observations. A fixed USDG notional assumption has no oracle source timestamp." } as const;
