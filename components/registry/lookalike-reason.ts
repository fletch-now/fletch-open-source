import type { Lookalike } from "@/lib/registry/authority/read";

export function lookalikeReason(row: Pick<Lookalike, "kind" | "exactName">): string {
  if (row.kind === "unlisted_stock") return "Recorded beacon dependency; issuer origin is unconfirmed.";
  if (row.kind === "unverified") return "Matching name or ticker at another address; issuer or bridge origin is unconfirmed.";
  if (row.kind === "same_ticker") return "Matching ticker at another address.";
  if (row.exactName) return "Matching name at another address; issuer origin is unconfirmed.";
  return "Matching ticker at another address; issuer origin is unconfirmed.";
}
