import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError, isAddress, zeroAddress, type Abi, type Address } from 'viem';
import { appChain, publicClient } from './network';

export interface ContractWrite {
  address?: Address;
  account?: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

export interface ConnectedWallet {
  address?: Address;
  chainId?: number;
}

export interface PreparedContractWrite {
  address: Address;
  account: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  chainId: number;
}

export class ContractPreflightError extends Error {}

export async function prepareContractWrite(input: ContractWrite, wallet: ConnectedWallet): Promise<PreparedContractWrite> {
  if (!wallet.address || !isAddress(wallet.address) || wallet.address === zeroAddress) {
    throw new ContractPreflightError('Connect your wallet before signing.');
  }
  if (wallet.chainId !== appChain.id) {
    throw new ContractPreflightError(`Switch to ${appChain.name} before signing.`);
  }
  if (!input.account || input.account.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new ContractPreflightError('The selected account changed. Review the action with your connected wallet.');
  }
  if (!input.address || !isAddress(input.address) || input.address === zeroAddress) {
    throw new ContractPreflightError('This contract has no valid deployment address.');
  }
  if (await publicClient.getChainId() !== appChain.id) {
    throw new ContractPreflightError('The chain connection returned a different network. Retry when the connection is restored.');
  }
  const code = await publicClient.getBytecode({ address: input.address });
  if (!code || code === '0x') {
    throw new ContractPreflightError('No contract was found at this address on the selected network.');
  }
  const request: PreparedContractWrite = {
    ...input, address: input.address, account: input.account,
    args: input.args ?? [], chainId: appChain.id,
  };
  await publicClient.simulateContract({ ...request, chain: appChain });
  // Simulation checks this snapshot only. The wallet still signs, and the caller
  // must wait for a successful receipt before treating the action as complete.
  return request;
}

export function contractActionError(cause: unknown): string {
  if (cause instanceof ContractPreflightError) return cause.message;
  if (cause instanceof BaseError) {
    if (cause.walk(function rejected(error) { return error instanceof UserRejectedRequestError; }) instanceof UserRejectedRequestError) {
      return 'The wallet request was declined. You can try again.';
    }
    if (cause.walk(function unfunded(error) { return error instanceof InsufficientFundsError; }) instanceof InsufficientFundsError) {
      return `Your wallet needs enough ETH on ${appChain.name} for the transaction and its gas fee.`;
    }
    const reverted = cause.walk(function revert(error) { return error instanceof ContractFunctionRevertedError; });
    if (reverted instanceof ContractFunctionRevertedError) {
      const reason = reverted.reason?.trim();
      if (reason && !/^execution reverted(?::\s*)?$/i.test(reason)) return `The contract rejected this action: ${reason.slice(0, 240)}`;
      const name = reverted.data?.errorName;
      if (name && name !== 'Error' && name !== 'Panic') return `The contract rejected this action (${name}). Check its requirements and try again.`;
      return 'The chain rejected this action without a readable reason. Check the network and account, then retry.';
    }
  }
  return 'The transaction could not be prepared or submitted. Check your wallet and chain connection, then retry.';
}
