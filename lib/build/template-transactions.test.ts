import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError, createPublicClient, custom, encodeAbiParameters, encodeErrorResult, encodeFunctionData, parseAbi, zeroAddress, type Address } from 'viem';
import { robinhoodTestnet } from 'viem/chains';
import type { Abi } from 'viem';

interface ContractWrite { address?: Address; account?: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint; }
interface ConnectedWallet { address?: Address; chainId?: number; }
interface PreparedContractWrite extends ContractWrite { address: Address; account: Address; chainId: number; args: readonly unknown[]; }

interface Helpers {
  prepareContractWrite(input: ContractWrite, wallet: ConnectedWallet): Promise<PreparedContractWrite>;
  contractActionError(cause: unknown): string;
}

const compiled = build({
  stdin: { contents: 'export * from "./docker/webapp-template/foundation/transactions";', resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'controlled-chain', setup(plugin) {
    plugin.onResolve({ filter: /^\.\/network$/ }, function resolve() { return { path: 'network', namespace: 'fixture' }; });
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, function mock() {
      return { loader: 'js', contents: 'export const appChain = fixture.chain; export const publicClient = fixture.client;' };
    });
  } }],
});

const ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
const CONTRACT: Address = '0x2222222222222222222222222222222222222222';
const ABI = parseAbi(['function enter(uint256 choice) payable returns (uint256)', 'error MatchClosed(uint256 matchId)']);
const request: ContractWrite = { address: CONTRACT, account: ACCOUNT, abi: ABI, functionName: 'enter', args: [BigInt(7)], value: BigInt(3) };
const wallet = { address: ACCOUNT, chainId: robinhoodTestnet.id };

async function fixture(options: { chainId?: number; code?: string; revert?: string } = {}): Promise<{ helpers: Helpers; calls: Array<{ method: string; params: unknown }> }> {
  const calls: Array<{ method: string; params: unknown }> = [];
  const client = createPublicClient({ chain: robinhoodTestnet, transport: custom({ async request({ method, params }) {
    calls.push({ method, params });
    if (method === 'eth_chainId') return `0x${(options.chainId ?? robinhoodTestnet.id).toString(16)}`;
    if (method === 'eth_getCode') return options.code ?? '0x6001600055';
    if (method === 'eth_call') {
      if (options.revert !== undefined) throw { code: 3, message: 'execution reverted', data: options.revert };
      return encodeAbiParameters([{ type: 'uint256' }], [BigInt(9)]);
    }
    throw new Error(`Unexpected RPC method ${method}`);
  } }, { retryCount: 0 }) });
  const loaded = { exports: {} as Helpers };
  new Function('require', 'module', 'exports', 'fixture', (await compiled).outputFiles[0].text)(
    createRequire(`${process.cwd()}/package.json`), loaded, loaded.exports, { chain: robinhoodTestnet, client },
  );
  return { helpers: loaded.exports, calls };
}

test('transaction preparation rejects disconnected, changed or wrong-network wallets and invalid targets before RPC', async function guards() {
  const { helpers, calls } = await fixture();
  for (const [input, connected, message] of [
    [request, {}, /Connect your wallet/],
    [request, { ...wallet, address: zeroAddress }, /Connect your wallet/],
    [request, { ...wallet, chainId: 1 }, /Switch to/],
    [{ ...request, account: undefined }, wallet, /selected account changed/],
    [{ ...request, account: CONTRACT }, wallet, /selected account changed/],
    [{ ...request, address: undefined }, wallet, /deployment address/],
    [{ ...request, address: zeroAddress }, wallet, /deployment address/],
    [{ ...request, address: '0x1234' }, wallet, /deployment address/],
  ] as Array<[ContractWrite, ConnectedWallet, RegExp]>) {
    await assert.rejects(helpers.prepareContractWrite(input, connected), message);
  }
  assert.equal(calls.length, 0);
});

test('RPC chain mismatch and absent bytecode prevent simulation', async function target() {
  const wrong = await fixture({ chainId: 1 });
  await assert.rejects(wrong.helpers.prepareContractWrite(request, wallet), /different network/);
  assert.deepEqual(wrong.calls.map(function method(call) { return call.method; }), ['eth_chainId']);
  const missing = await fixture({ code: '0x' });
  await assert.rejects(missing.helpers.prepareContractWrite(request, wallet), /No contract was found/);
  assert.deepEqual(missing.calls.map(function method(call) { return call.method; }), ['eth_chainId', 'eth_getCode']);
});

test('preparation simulates the exact ordinary-user calldata and value without signing or broadcasting', async function simulation() {
  const { helpers, calls } = await fixture();
  const prepared = await helpers.prepareContractWrite(request, wallet);
  assert.deepEqual(prepared, { ...request, chainId: robinhoodTestnet.id });
  assert.deepEqual(calls.map(function method(call) { return call.method; }), ['eth_chainId', 'eth_getCode', 'eth_call']);
  const [call] = calls[2].params as [{ to: string; from: string; data: string; value: string }];
  assert.equal(call.to, CONTRACT);
  assert.equal(call.from, ACCOUNT);
  assert.equal(call.value, '0x3');
  assert.equal(call.data, encodeFunctionData({ abi: ABI, functionName: 'enter', args: [BigInt(7)] }));
});

test('simulation failures keep decoded contract errors and readable fallback without claiming signed success', async function reverts() {
  const custom = await fixture({ revert: encodeErrorResult({ abi: ABI, errorName: 'MatchClosed', args: [BigInt(7)] }) });
  await assert.rejects(custom.helpers.prepareContractWrite(request, wallet), function decoded(cause: unknown) {
    assert.match(custom.helpers.contractActionError(cause), /MatchClosed/);
    return true;
  });
  const blank = await fixture({ revert: '0x' });
  await assert.rejects(blank.helpers.prepareContractWrite(request, wallet), function readable(cause: unknown) {
    assert.match(blank.helpers.contractActionError(cause), /without a readable reason/);
    return true;
  });
  assert.equal(custom.calls.some(function writes(call) { return /send|sign/i.test(call.method); }), false);
});

test('transaction errors distinguish rejected wallets, ETH funding, contract reasons and unavailable transport', async function errors() {
  const { helpers } = await fixture();
  assert.match(helpers.contractActionError(new BaseError('outer', { cause: new UserRejectedRequestError(new Error('fixture')) })), /declined/);
  assert.match(helpers.contractActionError(new BaseError('outer', { cause: new InsufficientFundsError() })), /enough ETH/);
  const reason = new ContractFunctionRevertedError({ abi: ABI, functionName: 'enter', message: 'Entry is closed' });
  assert.match(helpers.contractActionError(reason), /Entry is closed/);
  assert.doesNotMatch(helpers.contractActionError(new Error('PRIVATE_UPSTREAM flk_fixture_only')), /PRIVATE_UPSTREAM|flk_fixture_only/);
});

test('a disabled empty-lobby query is pending but does not represent an active load', function emptyLobby() {
  const client = new QueryClient();
  try {
    const result = new QueryObserver(client, { queryKey: ['lobby', 0], enabled: false, queryFn: async function read() { return []; } }).getCurrentResult();
    assert.equal(result.isPending, true);
    assert.equal(result.fetchStatus, 'idle');
    assert.equal(result.isLoading, false);
  } finally {
    client.clear();
  }
});
