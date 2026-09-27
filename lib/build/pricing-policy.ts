import { createHash } from "node:crypto";
import { z } from "zod";

export const PricingTier = z.enum(["small", "medium", "large"]);
export type PricingTier = z.infer<typeof PricingTier>;
export const AllowanceSchema = z.object({
  modelRequests: z.number().int().min(1).max(1000),
  toolRuns: z.number().int().min(1).max(500),
  activeSeconds: z.number().int().min(60).max(14_400),
  maxAgentStepsPerTurn: z.number().int().min(1).max(100),
}).strict();
export type BuildAllowance = z.infer<typeof AllowanceSchema>;
const PackageSchema = z.object({ credits: z.number().int().min(1).max(1000), allowance: AllowanceSchema }).strict();
export const PricingPolicySchema = z.object({
  schemaVersion: z.literal(1), chainId: z.literal(46630), mode: z.literal("fixed_packages"),
  tiers: z.object({ small: PackageSchema, medium: PackageSchema, large: PackageSchema }).strict(),
  quoteLifetimeSeconds: z.number().int().min(60).max(3600),
  approvalWindowSeconds: z.number().int().min(300).max(86_400),
  maxPackages: z.number().int().min(1).max(10),
  refund: z.literal("full_refund_on_failure_or_stop"),
}).strict().superRefine(function increasing(policy, context) {
  const tiers = [policy.tiers.small, policy.tiers.medium, policy.tiers.large];
  for (let i = 1; i < tiers.length; i++) {
    const previous = tiers[i - 1], current = tiers[i];
    if (current.credits < previous.credits || current.allowance.modelRequests < previous.allowance.modelRequests || current.allowance.toolRuns < previous.allowance.toolRuns || current.allowance.activeSeconds < previous.allowance.activeSeconds) {
      context.addIssue({ code: "custom", message: "Larger packages must include at least the previous package's price and allowance." });
    }
  }
});
export type PricingPolicy = z.infer<typeof PricingPolicySchema>;
export interface PublishedPricingPolicy { version: string; digest: string; publishedAt: string; publishedBy: string; policy: PricingPolicy }
export interface PricingSnapshot {
  schemaVersion: 1; policyVersion: string; policyDigest: string; tier: PricingTier;
  fixedCredits: number; allowance: BuildAllowance; maxPackages: number;
  approvalWindowSeconds: number; quoteLifetimeSeconds: number; refund: "full_refund_on_failure_or_stop";
  providerCost: "unknown_provider_billed" | "included_fixed_price"; chainId: 46630;
}

export function pricingDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function packageSnapshot(published: PublishedPricingPolicy, tier: PricingTier, ownKey: boolean): PricingSnapshot {
  const pack = published.policy.tiers[tier];
  return { schemaVersion: 1, policyVersion: published.version, policyDigest: published.digest, tier,
    fixedCredits: ownKey ? 0 : pack.credits, allowance: pack.allowance,
    quoteLifetimeSeconds: published.policy.quoteLifetimeSeconds, maxPackages: published.policy.maxPackages, approvalWindowSeconds: published.policy.approvalWindowSeconds,
    refund: published.policy.refund, providerCost: ownKey ? "unknown_provider_billed" : "included_fixed_price", chainId: 46630 };
}

export function quotedTotal(snapshot: PricingSnapshot, packages: number): { credits: number; allowance: BuildAllowance } {
  if (!Number.isSafeInteger(packages) || packages < 1 || packages > snapshot.maxPackages) throw new Error("Package limit exceeded.");
  return { credits: snapshot.fixedCredits * packages, allowance: {
    modelRequests: snapshot.allowance.modelRequests * packages,
    toolRuns: snapshot.allowance.toolRuns * packages,
    activeSeconds: snapshot.allowance.activeSeconds * packages,
    maxAgentStepsPerTurn: snapshot.allowance.maxAgentStepsPerTurn,
  } };
}
