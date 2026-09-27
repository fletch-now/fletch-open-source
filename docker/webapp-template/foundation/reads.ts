import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Abi, Address } from 'viem';
import { appChain, publicClient } from './network';

const SOLIDITY_BLOCK_ABI = [{ type: 'function', name: 'getBlockNumber', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;

// RPC heights describe chain progress. Solidity block.number uses a different
// clock on Robinhood Chain; read it through a contract for block-based deadlines.
export function useChainBlockNumber(): UseQueryResult<bigint, Error> {
  return useQuery({ queryKey: ['chain-block', appChain.id], queryFn: function readChainBlock() { return publicClient.getBlockNumber(); }, refetchInterval: 30_000 });
}

export function useSolidityBlockNumber(): UseQueryResult<bigint, Error> {
  return useQuery({ queryKey: ['solidity-block', appChain.id], queryFn: function readSolidityBlock() {
    return publicClient.readContract({ address: appChain.contracts.multicall3.address, abi: SOLIDITY_BLOCK_ABI, functionName: 'getBlockNumber' });
  }, refetchInterval: 30_000 });
}

export function useNativeBalance(address?: Address): UseQueryResult<bigint, Error> {
  return useQuery({ queryKey: ['balance', appChain.id, address], enabled: Boolean(address), queryFn: function readBalance() {
    if (!address) throw new Error('Enter a wallet address to read its balance.');
    return publicClient.getBalance({ address });
  }, refetchInterval: 30_000 });
}

interface ContractRead { address?: Address; abi: Abi; functionName: string; args?: readonly unknown[]; }

export function useContractRead({ address, abi, functionName, args = [] }: ContractRead): UseQueryResult<unknown, Error> {
  return useQuery({ queryKey: ['contract', appChain.id, address, functionName, JSON.stringify(args, function bigintValue(_key, value) { return typeof value === 'bigint' ? value.toString() : value; }), abi], enabled: Boolean(address), queryFn: function readContract() {
    if (!address) throw new Error('This contract has not been deployed.');
    return publicClient.readContract({ address, abi, functionName, args });
  }, refetchInterval: 30_000 });
}
