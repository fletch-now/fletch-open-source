import "server-only";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { and, desc, eq } from "drizzle-orm";
import { encodeAbiParameters, getAddress, type Abi, type Hex } from "viem";
import { db } from "@/lib/db";
import { builds, contracts, projects } from "@/lib/db/schema";
import { getChainClient, PUBLIC_RPC_URLS } from "@/lib/chain/rpc";
import { explorerAddressUrl, explorerBaseUrl } from "@/lib/chain/explorer";
import { RH_MAINNET_ID } from "@/lib/config";
import { logEvent } from "@/lib/log";
import { walletsForUser } from "@/lib/wallets";
import { creationData, findContractPathByBytecode, mainnetDeploysEnabled, takesOwner } from "@/lib/build/deploy";
import { verifyOnBlockscout } from "@/lib/build/verify";
import { buildWebApp, hasFrontEnd } from "@/lib/build/web";
import { publishSite } from "@/lib/hosting/publish";
import { workspaceRoot } from "@/lib/build/workspace";
import { SOLC_VERSION } from "@/lib/build/foundry";

// A mainnet deployment is signed by the person's own wallet in the browser
// and only recorded here. The server checks the transaction against the
// bytecode it compiled and the wallet the account owns, then does the parts
// that need no key: source verification on the explorer and a front end
// rebuilt against the mainnet address. No server key ever signs on mainnet.

export type MainnetRecordResult =
  | {
      ok: true;
      address: string;
      explorerUrl: string;
      verified: boolean;
      verifyError: string | null;
      previewUrl: string | null;
      hostingNote: string | null;
    }
  | { ok: false; error: string };

interface Deployable {
  buildId: string;
  projectId: string | null;
  slug: string | null;
  abi: Abi;
  bytecode: Hex;
}

async function deployableFor(buildId: string, userId: string): Promise<Deployable | { error: string }> {
  const rows = await db
    .select({ buildId: builds.id, userId: builds.userId, projectId: builds.projectId, slug: projects.slug })
    .from(builds)
    .leftJoin(projects, eq(projects.id, builds.projectId))
    .where(eq(builds.id, buildId))
    .limit(1);
  const build = rows[0];
  if (!build || build.userId !== userId) {
    return { error: "Build not found." };
  }
  const testnetRows = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.buildId, buildId), eq(contracts.deployer, "platform")))
    .orderBy(desc(contracts.createdAt))
    .limit(1);
  const testnet = testnetRows[0];
  if (!testnet || !testnet.bytecode || !testnet.abi) {
    return { error: "This build has no testnet deployment with stored bytecode. Deploy to testnet first; mainnet uses the same compiled contract." };
  }
  return { buildId, projectId: build.projectId, slug: build.slug, abi: testnet.abi as Abi, bytecode: testnet.bytecode as Hex };
}

async function workspaceExists(slug: string | null): Promise<string | null> {
  if (!slug) {
    return null;
  }
  const path = join(workspaceRoot(), slug);
  try {
    await access(path);
    return path;
  } catch {
    return null;
  }
}

export interface RecordMainnetInput {
  buildId: string;
  userId: string;
  txHash: Hex;
}

export async function recordMainnetDeployment(input: RecordMainnetInput): Promise<MainnetRecordResult> {
  if (!mainnetDeploysEnabled()) {
    return { ok: false, error: "Mainnet deploys are not open on this server." };
  }
  const deployable = await deployableFor(input.buildId, input.userId);
  if ("error" in deployable) {
    return { ok: false, error: deployable.error };
  }
  const client = getChainClient(RH_MAINNET_ID);
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: input.txHash }).catch(function missing() {
      return null;
    }),
    client.getTransactionReceipt({ hash: input.txHash }).catch(function missing() {
      return null;
    }),
  ]);
  if (!tx || !receipt) {
    return { ok: false, error: "That transaction is not on Robinhood Chain mainnet yet. Wait for it to be mined and try again." };
  }
  if (receipt.status !== "success" || !receipt.contractAddress) {
    return { ok: false, error: "That transaction did not create a contract, or it reverted." };
  }
  const owned = (await walletsForUser(input.userId)).map((address) => address.toLowerCase());
  if (!owned.includes(tx.from.toLowerCase())) {
    return { ok: false, error: `The transaction was sent from ${tx.from}, which is not a wallet on this account.` };
  }
  // The creation calldata must be the compiled bytecode plus, when the
  // constructor takes an owner, one of the account's own wallets as that owner.
  const acceptable = takesOwner(deployable.abi)
    ? owned.map((wallet) => creationData(deployable.abi, deployable.bytecode, getAddress(wallet)).toLowerCase())
    : [deployable.bytecode.toLowerCase()];
  if (!acceptable.includes(tx.input.toLowerCase())) {
    return { ok: false, error: "The transaction's bytecode is not the contract this build compiled, or its owner is not a wallet on this account." };
  }
  // With one address argument, the owner is the last twenty bytes of the calldata.
  const owner = takesOwner(deployable.abi) ? getAddress(`0x${tx.input.slice(-40)}`) : null;
  const constructorArgs = takesOwner(deployable.abi) && owner ? encodeAbiParameters([{ type: "address" }], [owner]) : "0x";

  const address = receipt.contractAddress;
  const existing = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.buildId, input.buildId), eq(contracts.chainId, RH_MAINNET_ID), eq(contracts.address, address)))
    .limit(1);
  if (existing[0]) {
    // Already recorded: answer from the row rather than verifying and
    // republishing again for every repeat of the same transaction.
    const row = await db.select().from(contracts).where(eq(contracts.id, existing[0].id)).limit(1);
    const project = deployable.projectId ? await db.select({ previewUrl: projects.previewUrl }).from(projects).where(eq(projects.id, deployable.projectId)).limit(1) : [];
    return { ok: true, address, explorerUrl: explorerAddressUrl(RH_MAINNET_ID, address), verified: Boolean(row[0]?.verified), verifyError: row[0]?.verifyError ?? null, previewUrl: project[0]?.previewUrl ?? null, hostingNote: null };
  }
  const id = randomUUID();
  if (!existing[0]) {
    await db.insert(contracts).values({
      id,
      buildId: input.buildId,
      chainId: RH_MAINNET_ID,
      address,
      txHash: input.txHash,
      abi: deployable.abi as unknown[],
      bytecode: deployable.bytecode,
      ownerAddress: owner,
      deployer: "user",
      confirmedAt: new Date(),
    });
    logEvent("deploy", { event: "mainnet-recorded", chainId: RH_MAINNET_ID, address, buildId: input.buildId, from: tx.from });
  }

  const workspace = await workspaceExists(deployable.slug);
  let verified = false;
  let verifyError: string | null = "The build's workspace is no longer on the server; verify the source from the explorer's own page.";
  let previewUrl: string | null = null;
  let hostingNote: string | null = "The build's workspace is no longer on the server, so the front end was not rebuilt for mainnet.";
  if (workspace) {
    // forge names the artifact "contracts/Token.sol:Token"; the one whose
    // creation bytecode matches is the contract that went on chain.
    const contractPath = await findContractPathByBytecode(workspace, deployable.bytecode);
    const verification = contractPath
      ? await verifyOnBlockscout({ workspace, chainId: RH_MAINNET_ID, address, contractPath, contractName: contractPath.split(":")[1] ?? "Contract", solc: SOLC_VERSION, constructorArgs })
      : { ok: false as const, error: "The compiled artifact for this bytecode is no longer in the workspace; verify from the explorer's own page." };
    verified = verification.ok;
    verifyError = verification.ok ? null : verification.error;
    await db.update(contracts).set({ verified, verifiedAt: verified ? new Date() : null, verifyError }).where(eq(contracts.id, id));

    if (await hasFrontEnd(workspace)) {
      const web = await buildWebApp(workspace, {
        contractAddress: address,
        chainId: RH_MAINNET_ID,
        rpcUrl: PUBLIC_RPC_URLS[RH_MAINNET_ID],
        explorerUrl: explorerBaseUrl(RH_MAINNET_ID),
        walletConnectProjectId: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID,
      });
      if (web.ok && deployable.slug) {
        const published = await publishSite(deployable.slug, `${input.buildId}-mainnet`, join(workspace, "dist"), web.bytes);
        if (published.ok) {
          previewUrl = published.url;
          hostingNote = null;
          if (deployable.projectId) {
            await db.update(projects).set({ previewUrl }).where(eq(projects.id, deployable.projectId));
          }
        } else {
          hostingNote = published.error;
        }
      } else if (!web.ok) {
        hostingNote = web.skipped ? web.reason : web.error;
      }
    } else {
      hostingNote = null;
    }
  }
  return { ok: true, address, explorerUrl: explorerAddressUrl(RH_MAINNET_ID, address), verified, verifyError, previewUrl, hostingNote };
}
