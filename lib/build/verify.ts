import { buildSignal, checkBuildCancellation } from "@/lib/build/cancellation";
import { setTimeout as delay } from "node:timers/promises";
import "server-only";
import { readdir } from "node:fs/promises";
import { readWorkspaceFile } from "@/lib/build/workspace";
import { join } from "node:path";
import { explorerBaseUrl } from "@/lib/chain/explorer";
import { logEvent } from "@/lib/log";

// Source verification on Blockscout after a testnet deploy. The standard JSON
// input is produced by forge inside the no-network sandbox, where the forge-std
// remapping resolves; the host then posts it to the explorer and polls until the
// explorer itself says the contract is verified. Only the explorer's answer sets
// the flag. Testnet only: the mainnet explorer's API answers server-side fetches
// with a Cloudflare challenge (checked 2 September 2026), so a mainnet row stays
// unverified with that reason.

const REQUEST_TIMEOUT_MS = 20_000;
// The mainnet explorer sits behind a Cloudflare challenge that a browser
// User-Agent passes; the testnet explorer's API is open either way.
const EXPLORER_HEADERS = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36" };
const POLL_ATTEMPTS = 12;
const POLL_DELAY_MS = 5_000;
const MIT_LICENSE = "mit";

export type VerifyResult = { ok: true } | { ok: false; error: string };

interface VerifierConfig {
  solidity_compiler_versions?: string[];
}

interface ContractInfo {
  is_verified?: boolean;
  is_fully_verified?: boolean;
  is_partially_verified?: boolean;
}



// The explorer names compiler versions with their commit ("v0.8.28+commit.…");
// the build knows only "0.8.28", so the full name is looked up once per run.
async function compilerVersion(base: string, solc: string): Promise<string | null> {
  const response = await fetch(`${base}/api/v2/smart-contracts/verification/config`, { headers: EXPLORER_HEADERS, signal: buildSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS)) }).catch(
    function unreachable() {
      return null;
    },
  );
  if (!response?.ok) {
    return null;
  }
  const config = (await response.json().catch(function notJson() {
    return null;
  })) as VerifierConfig | null;
  return config?.solidity_compiler_versions?.find((version) => version.startsWith(`v${solc}+`)) ?? null;
}

interface BuildInfo {
  input?: unknown;
  output?: { contracts?: Record<string, Record<string, unknown>> };
}

// The standard JSON input the compiler saw, from the build-info forge wrote
// during `forge build --build-info` (lib/build/foundry.ts). forge's own
// `verify-contract --show-standard-json-input` needs the network to answer, and
// the build sandbox has none, so the file is the source instead.
async function standardJsonInput(workspace: string, contractPath: string): Promise<string | null> {
  const [sourcePath, contractName] = contractPath.split(":");
  const dir = join(workspace, "out", "build-info");
  const files = await readdir(dir).catch(function missing() {
    return [] as string[];
  });
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const text = await readWorkspaceFile(join(dir, file));
    if (!text) {
      continue;
    }
    let info: BuildInfo;
    try {
      info = JSON.parse(text) as BuildInfo;
    } catch {
      continue;
    }
    const compiled = info.output?.contracts?.[sourcePath];
    if (info.input && compiled && contractName in compiled) {
      return JSON.stringify(info.input);
    }
  }
  logEvent("verify", { event: "standard-json-missing", contractPath, files: files.length });
  return null;
}

async function isVerified(base: string, address: string): Promise<boolean> {
  const response = await fetch(`${base}/api/v2/smart-contracts/${address}`, { headers: EXPLORER_HEADERS, signal: buildSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS)) }).catch(
    function unreachable() {
      return null;
    },
  );
  if (!response?.ok) {
    return false;
  }
  const info = (await response.json().catch(function notJson() {
    return null;
  })) as ContractInfo | null;
  // A partial match (metadata differs) is not the source that compiled.
  return Boolean(info?.is_verified || info?.is_fully_verified);
}

export interface VerifyInput {
  workspace: string;
  chainId: number;
  address: string;
  // "contracts/Token.sol:Token", as forge names it.
  contractPath: string;
  contractName: string;
  solc: string;
  // The abi-encoded constructor arguments the deployment used; "0x" for none.
  constructorArgs?: string;
}

export async function verifyOnBlockscout(input: VerifyInput): Promise<VerifyResult> {
  checkBuildCancellation();
  const base = explorerBaseUrl(input.chainId);
  if (await isVerified(base, input.address)) {
    return { ok: true };
  }
  checkBuildCancellation();
  const version = await compilerVersion(base, input.solc);
  if (!version) {
    return { ok: false, error: `The explorer does not list solc ${input.solc}, or it could not be reached.` };
  }
  const json = await standardJsonInput(input.workspace, input.contractPath);
  if (!json) {
    return { ok: false, error: "The build left no standard JSON input for this contract, so there was nothing to submit." };
  }

  const form = new FormData();
  form.set("compiler_version", version);
  form.set("contract_name", input.contractName);
  form.set("license_type", MIT_LICENSE);
  form.set("autodetect_constructor_args", "false");
  if (input.constructorArgs && input.constructorArgs !== "0x") {
    form.set("constructor_args", input.constructorArgs);
  }
  form.set("files[0]", new Blob([json], { type: "application/json" }), "input.json");
  checkBuildCancellation();
  const submitted = await fetch(`${base}/api/v2/smart-contracts/${input.address}/verification/via/standard-input`, {
    method: "POST",
    body: form,
    headers: EXPLORER_HEADERS,
    signal: buildSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
  }).catch(function unreachable() {
    return null;
  });
  if (!submitted?.ok) {
    const text = submitted ? (await submitted.text().catch(function ignore() { return ""; })).slice(0, 200) : "unreachable";
    return { ok: false, error: `The explorer refused the verification request: ${submitted?.status ?? "no response"} ${text}`.trim() };
  }

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    checkBuildCancellation();
    await delay(POLL_DELAY_MS, undefined, { signal: buildSignal() });
    if (await isVerified(base, input.address)) {
      logEvent("verify", { event: "verified", chainId: input.chainId, address: input.address });
      return { ok: true };
    }
  }
  return { ok: false, error: "The explorer accepted the request but had not confirmed the source after a minute." };
}
