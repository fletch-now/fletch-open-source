import { assertWorkerExecution, currentWorkerExecution, recordWorkerDispatchEvidence, workerOperation } from "@/lib/build/durable/execution";
import { withResourceLock } from "@/lib/build/resource-lock";
import { pool } from "@/lib/db";
import { buildSignal, withBuildCancellation, checkBuildCancellation } from "@/lib/build/cancellation";
import "server-only";
import { readWorkspaceFile } from "@/lib/build/workspace";
import { join } from "node:path";
import { createPublicClient, createWalletClient, custom, encodeAbiParameters, encodeDeployData, formatEther, http, keccak256, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodTestnet } from "viem/chains";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/chain/explorer";
import { getRpcUrl } from "@/lib/chain/rpc";
import { RH_TESTNET_ID } from "@/lib/config";
import { logEvent } from "@/lib/log";
import type { ContractSummary } from "@/lib/build/types";
import { artifactContractIdentity, constructorShape, selectDeploymentTarget } from "@/lib/build/deployment-target";

// Deploys the compiled contract to Robinhood testnet from a platform key. The key
// lives only in the environment (FORGE_DEPLOYER_KEY_46630), signs from the host,
// and never enters the sandbox. It pays the gas and nothing more: the contract's
// owner is the person's wallet, passed to the constructor. Testnet only: mainnet
// deploys are signed by the person's own wallet, never by a key on this server.

const RECEIPT_TIMEOUT_MS = 90_000;
// Enough for a small contract at testnet gas prices; below this a deploy would
// fail after spending the fee, which is worse than saying so up front.
const MIN_BALANCE_WEI = BigInt(2_000_000_000_000_000); // 0.002 ETH

export type DeployResult =
  | {
      ok: true;
      address: string;
      txHash: string | null;
      explorerUrl: string;
      contractName: string;
      contractPath: string;
      abi: Abi;
      bytecodeHash: string;
      bytecode: Hex;
      // The abi-encoded constructor arguments, empty when the constructor takes none.
      constructorArgs: Hex;
      owner: Address | null;
      reused: boolean;
    }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

export interface PreviousDeploy {
  address: string;
  bytecodeHash: string;
}

interface ForgeArtifact {
  abi?: Abi;
  bytecode?: { object?: string };
}

function deployerKey(): Hex | null {
  const key = process.env[`FORGE_DEPLOYER_KEY_${RH_TESTNET_ID}`];
  return key && /^0x[0-9a-fA-F]{64}$/.test(key) ? (key as Hex) : null;
}

// Mainnet deploys are signed by the person's own wallet in the browser and
// only recorded here (lib/build/mainnet.ts). They open when the operator sets
// FORGE_MAINNET_DEPLOYS=1; until then every surface says they are not open.
export function mainnetDeploysEnabled(): boolean {
  return process.env.FORGE_MAINNET_DEPLOYS === "1";
}

export function deployerAddress(): string | null {
  const key = deployerKey();
  return key ? privateKeyToAccount(key).address : null;
}

export function takesOwner(abi: Abi): boolean {
  return constructorShape(abi) === "owner";
}

// The creation calldata for a given owner: what a wallet sends, and what the
// server compares a mainnet transaction against byte for byte.
export function creationData(abi: Abi, bytecode: Hex, owner: Address | null): Hex {
  return takesOwner(abi) && owner ? encodeDeployData({ abi, bytecode, args: [owner] }) : bytecode;
}

export async function findContractPathByBytecode(workspace: string, bytecode: Hex): Promise<string | null> {
  const outDir = join(workspace, "out");
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(outDir, { withFileTypes: true }).catch(function missing() {
    return [];
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(".sol")) {
      continue;
    }
    const files = await readdir(join(outDir, entry.name)).catch(function missing() {
      return [] as string[];
    });
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const text = await readWorkspaceFile(join(outDir, entry.name, file));
      if (!text) {
        continue;
      }
      let artifact: ForgeArtifact;
      try { artifact = JSON.parse(text) as ForgeArtifact; }
      catch { continue; }
      const identity = artifactContractIdentity(artifact);
      if (identity && artifact.bytecode?.object?.toLowerCase() === bytecode.toLowerCase()) {
        return `${identity.source}:${identity.contract}`;
      }
    }
  }
  return null;
}

async function deployToTestnetInternal(
  workspace: string,
  contracts: ContractSummary[],
  previous: PreviousDeploy | null,
  owner: Address | null,
  onBroadcast?: (txHash: string) => Promise<void>,
): Promise<DeployResult> {
  if (currentWorkerExecution()?.signal.aborted) return { ok: false, skipped: false, error: "Stopped before transaction dispatch." };
  checkBuildCancellation();
  const key = deployerKey();
  if (!key) {
    return { ok: false, skipped: true, reason: "No testnet deployer key is configured on this server." };
  }
  let chosen: Awaited<ReturnType<typeof selectDeploymentTarget>>;
  try {
    chosen = await selectDeploymentTarget(workspace, contracts, previous?.bytecodeHash);
  } catch (cause) {
    if (currentWorkerExecution()?.signal.aborted) return { ok: false, skipped: false, error: "Stopped before transaction dispatch." };
    checkBuildCancellation();
    return { ok: false, skipped: false, error: cause instanceof Error ? cause.message : "The deployment entrypoint could not be resolved." };
  }
  if (!chosen) {
    return {
      ok: false,
      skipped: true,
      reason: "No deployable contract: the constructor must take no arguments or exactly one owner address.",
    };
  }
  if (chosen.shape === "owner" && !owner) {
    return { ok: false, skipped: true, reason: "The contract takes an owner, but this account has no wallet to own it. Sign in with a wallet and build again." };
  }
  const bytecodeHash = keccak256(chosen.bytecode);
  const constructorOwner = chosen.shape === "owner" ? owner : null;
  const shared = {
    contractName: chosen.summary.name,
    contractPath: `${chosen.summary.source}:${chosen.summary.name}`,
    abi: chosen.abi,
    bytecodeHash,
    bytecode: chosen.bytecode,
    constructorArgs: (constructorOwner ? encodeAbiParameters([{ type: "address" }], [constructorOwner]) : "0x") as Hex,
    owner: constructorOwner,
  };
  // A follow-up that only touched the front end leaves the bytecode identical;
  // the contract already on chain is the same contract, so it keeps its address.
  if (previous && previous.bytecodeHash === bytecodeHash) {
    logEvent("deploy", { event: "reused", chainId: RH_TESTNET_ID, address: previous.address, contract: chosen.summary.name });
    return { ok: true, ...shared, address: previous.address, txHash: null, explorerUrl: explorerAddressUrl(RH_TESTNET_ID, previous.address), reused: true };
  }
  const account = privateKeyToAccount(key);
  const database = currentWorkerExecution()?.pool ?? pool;
  const pending = await database.query(`
    select 1 from build_worker_effects e join build_worker_events v
      on v.build_id=e.build_id and v.attempt=e.attempt and v.detail->>'effectKey'=e.effect_key
    where e.kind='deployment' and e.state='uncertain' and v.kind='transaction_prepared'
      and v.detail->>'chainId'=$1 and lower(v.detail->>'sender')=$2 limit 1
  `, [String(RH_TESTNET_ID), account.address.toLowerCase()]);
  if (pending.rows.length) return { ok: false, skipped: false, error: "An earlier deployment from this account still needs reconciliation. Your files are saved." };
  const transport = http(getRpcUrl(RH_TESTNET_ID));
  const publicClient = createPublicClient({ chain: robinhoodTestnet, transport });
  let transactionPrepared = false;
  const walletTransport = http(getRpcUrl(RH_TESTNET_ID), { retryCount: 0 })({ chain: robinhoodTestnet });
  const wallet = createWalletClient({ account, chain: robinhoodTestnet, transport: custom({
    async request(args: Parameters<typeof publicClient.transport.request>[0]): Promise<unknown> {
      // Deploy preparation can make several RPC calls before sending raw bytes.
      checkBuildCancellation();
      await assertWorkerExecution();
      if (args.method === "eth_sendRawTransaction") {
        const raw = (args.params as readonly Hex[])[0];
        await recordWorkerDispatchEvidence("transaction_prepared", {
          chainId: RH_TESTNET_ID, txHash: keccak256(raw), sender: account.address,
          bytecodeHash, owner: constructorOwner, signedTransaction: raw, deployment: shared,
        });
        checkBuildCancellation();
        await assertWorkerExecution();
        transactionPrepared = true;
      }
      return walletTransport.request(args);
    },
  }, { retryCount: 0 }) });
  try {
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance < MIN_BALANCE_WEI) {
      return {
        ok: false,
        skipped: true,
        reason: `The testnet deployer wallet ${account.address} holds ${formatEther(balance)} ETH; it needs testnet ETH from the faucet before it can deploy.`,
      };
    }
    checkBuildCancellation();
    const txHash = constructorOwner
      ? await wallet.deployContract({ abi: chosen.abi, bytecode: chosen.bytecode, args: [constructorOwner] })
      : await wallet.deployContract({ abi: chosen.abi, bytecode: chosen.bytecode });
    await onBroadcast?.(txHash);
    // A sent transaction must finish reconciliation even when Stop arrives.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: RECEIPT_TIMEOUT_MS });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      return { ok: false, skipped: false, error: `Deploy transaction ${txHash} reverted.` };
    }
    logEvent("deploy", { event: "deployed", chainId: RH_TESTNET_ID, address: receipt.contractAddress, txHash, contract: chosen.summary.name, owner: constructorOwner });
    return {
      ok: true,
      ...shared,
      address: receipt.contractAddress,
      txHash,
      explorerUrl: explorerAddressUrl(RH_TESTNET_ID, receipt.contractAddress),
      reused: false,
    };
  } catch (cause) {
    if (transactionPrepared && currentWorkerExecution()) throw new Error("The transaction outcome is not yet confirmed. Its saved identity must be checked before continuing.");
    if (currentWorkerExecution()?.signal.aborted) return { ok: false, skipped: false, error: "Stopped before transaction dispatch." };
    checkBuildCancellation();
    const message = cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
    logEvent("deploy", { event: "failed", chainId: RH_TESTNET_ID, error: message });
    return { ok: false, skipped: false, error: `Deploy failed: ${message.slice(0, 200)}` };
  }
}

export { explorerTxUrl };

export async function deployToTestnet(
  workspace: string, contracts: ContractSummary[], previous: PreviousDeploy | null, owner: Address | null,
  onBroadcast?: (txHash: string) => Promise<void>,
): Promise<DeployResult> {
  const sender = deployerAddress();
  if (!sender) return workerOperation("deployment", "deployment", () => deployToTestnetInternal(workspace, contracts, previous, owner, onBroadcast));
  // Keep the sender lock through the durable receipt, not only the RPC send.
  return withResourceLock(`deployer:${RH_TESTNET_ID}:${sender.toLowerCase()}`, async function deploy(signal) {
    return workerOperation("deployment", "deployment", () => withBuildCancellation(buildSignal(signal)!,
      () => deployToTestnetInternal(workspace, contracts, previous, owner, onBroadcast)));
  }, { database: currentWorkerExecution()?.pool ?? pool });
}
