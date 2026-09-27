import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { keccak256, type Abi, type Hex } from "viem";
import { z } from "zod";
import type { ContractSummary } from "@/lib/build/types";
import { isSafeRelativePath, readWorkspaceFile } from "@/lib/build/workspace-files";

export const DEPLOYMENT_MANIFEST = "fletch.deploy.json";
const ContractIdentitySchema = z.object({
  source: z.string().max(400).refine(isSafeRelativePath).refine(function solidity(path) {
    return path.startsWith("contracts/") && path.endsWith(".sol");
  }),
  contract: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/).max(200),
}).strict();
const ManifestSchema = ContractIdentitySchema.extend({ version: z.literal(1) }).strict();
const ArtifactIdentitySchema = z.object({
  metadata: z.object({ settings: z.object({ compilationTarget: z.record(z.string(), z.string()) }) }),
});

export function artifactContractIdentity(artifact: unknown): z.infer<typeof ContractIdentitySchema> | null {
  const parsed = ArtifactIdentitySchema.safeParse(artifact);
  if (!parsed.success) return null;
  const entries = Object.entries(parsed.data.metadata.settings.compilationTarget);
  if (entries.length !== 1) return null;
  const identity = ContractIdentitySchema.safeParse({ source: entries[0][0], contract: entries[0][1] });
  return identity.success ? identity.data : null;
}

export type ConstructorShape = "none" | "owner" | "other";

export interface DeploymentTarget {
  summary: ContractSummary;
  abi: Abi;
  bytecode: Hex;
  shape: ConstructorShape;
}

export function constructorShape(abi: Abi): ConstructorShape {
  const ctor = abi.find(function constructor(item) { return item.type === "constructor"; });
  const inputs = ctor && "inputs" in ctor ? ctor.inputs : [];
  if (inputs.length === 0) return "none";
  if (inputs.length === 1 && inputs[0].type === "address") return "owner";
  return "other";
}

function isApplicationContract(summary: ContractSummary): boolean {
  return !/(Test|Mock|Script|Harness|Fixture)$/.test(summary.name)
    && !/(^|\/)(test|tests|script|scripts|mocks?)\//.test(summary.source);
}

async function readManifest(workspace: string): Promise<z.infer<typeof ManifestSchema> | null> {
  const exists = await lstat(join(workspace, DEPLOYMENT_MANIFEST)).catch(function absent(error: NodeJS.ErrnoException) {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!exists) return null;
  const content = await readWorkspaceFile(workspace, DEPLOYMENT_MANIFEST, 8_192);
  if (!content) throw new Error(`${DEPLOYMENT_MANIFEST} must be a readable regular file of at most 8 KB.`);
  let manifest: unknown;
  try { manifest = JSON.parse(content); }
  catch { throw new Error(`${DEPLOYMENT_MANIFEST} must contain valid JSON.`); }
  const parsed = ManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new Error(`${DEPLOYMENT_MANIFEST} must specify version 1, a contracts/*.sol source and its compiled contract name.`);
  }
  return parsed.data;
}

async function readTarget(workspace: string, summary: ContractSummary): Promise<DeploymentTarget | null> {
  const sourceFile = summary.source.split("/").pop();
  if (!sourceFile) return null;
  const text = await readWorkspaceFile(workspace, `out/${sourceFile}/${summary.name}.json`, 32 * 1024 * 1024);
  if (!text) return null;
  let artifact: { abi?: Abi; bytecode?: { object?: string } };
  try { artifact = JSON.parse(text); }
  catch { return null; }
  const identity = artifactContractIdentity(artifact);
  if (identity?.source !== summary.source || identity.contract !== summary.name) return null;
  if (!Array.isArray(artifact?.abi) || !artifact.bytecode?.object) return null;
  const bytecode = artifact.bytecode.object;
  if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(bytecode)) return null;
  const shape = constructorShape(artifact.abi);
  if (shape === "other") return null;
  return { summary, abi: artifact.abi, bytecode: bytecode as Hex, shape };
}

export async function selectDeploymentTarget(
  workspace: string,
  contracts: ContractSummary[],
  previousBytecodeHash?: string,
): Promise<DeploymentTarget | null> {
  const manifest = await readManifest(workspace);
  const candidates: DeploymentTarget[] = [];
  for (const summary of contracts.filter(isApplicationContract)) {
    if (manifest && (summary.source !== manifest.source || summary.name !== manifest.contract)) continue;
    const target = await readTarget(workspace, summary);
    if (target) candidates.push(target);
  }
  if (manifest) {
    if (candidates.length !== 1) {
      throw new Error(`${DEPLOYMENT_MANIFEST} must identify one compiled application contract with a supported constructor.`);
    }
    return candidates[0];
  }
  if (candidates.length <= 1) return candidates[0] ?? null;
  // An unchanged deployed entrypoint is stronger evidence than code size.
  const previous = candidates.filter(function matches(target) {
    return keccak256(target.bytecode) === previousBytecodeHash;
  });
  if (previous.length === 1) return previous[0];
  throw new Error(`Several contracts can be deployed. Write ${DEPLOYMENT_MANIFEST} with version 1, source and contract to identify the app's entrypoint.`);
}
