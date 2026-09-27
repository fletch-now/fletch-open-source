# Fletch frontend foundation 2.0.4

Vite/React source and pinned dependencies are baked into `/opt/webapp`.
`prepare.mjs` copies only `foundation/` into a new `fletch/` workspace directory.
It preserves every existing file and never copies the example into an app.
`example/` is a reference page for local validation; its main file belongs in
`src/main.tsx` when testing alongside `fletch/`.

Import `fletch/tokens.css`, then declare the application's purpose-derived palette.
Use `DataProvider` for public read hooks. Signing apps use `WalletProvider` and one
`WalletControl` instead, and check `useWalletReady` before submitting a transaction.
Restyle that component for the requested design. Only the supplied
`VITE_WALLETCONNECT_PROJECT_ID` enables Reown/WalletConnect. Without that ID, the
same control offers detected injected EVM wallets through wagmi. EIP-6963
discovery and the collision-safe `window.phantom.ethereum` provider are supported.
No alternate wallet stack or invented credential is created.

Phantom documents Robinhood Chain and Robinhood Chain Testnet support; testnet
mode must be enabled in its developer settings. Wallet versions and settings can
still reject a switch, and the component displays that error while signing stays
blocked on the wrong chain. Phantom does not inject into iframes, so embedded
previews link to the hosted app in a new tab. A browser wallet can only appear
where its EVM provider is actually available.

Block clocks have explicit names. `useChainBlockNumber` reads the RPC chain height
for chain progress and explorer links. `useSolidityBlockNumber` calls the configured
chain's Multicall3 `getBlockNumber()` to read the clock Solidity exposes as
`block.number`. Use that second clock when comparing a contract's block-based
deadline. Robinhood Chain's RPC height and Solidity block number can differ by
millions of blocks; comparing them can hide a valid transaction action.

Both hooks refresh every 30 seconds and have separate cache keys. Neither falls
back to the other clock. Show “Unavailable” and disable deadline-dependent actions
when `isError` is true or `data` is undefined. A failed refetch can retain an older
cached value, so check `isError` before displaying or acting on `data`.
`useBlockNumber` is deliberately not exported: an ambiguous import fails the
normal TypeScript build and can be corrected through the ordinary repair pass.
An image update preserves existing projects' editable `fletch/` directories.

The immutable image manifest is emitted by `build.mjs` before Vite executes project
code; Fletch records it with the hosting event. `fletch/template.json` records the
starter's original version in project source and is preserved during follow-ups.
Future template releases require a new version and image validation.

## Preparing a contract action

New foundations include `transactions.ts`. Pass the deployed contract's compiled
ABI, exact arguments and value to `prepareContractWrite`, along with the current
wallet address and chain ID. It validates the target and account, checks the RPC
network and deployed bytecode, then simulates the call without signing or sending
a transaction. These are three bounded RPC reads on a valid target.

```ts
import { getAccount } from 'wagmi/actions';
import { prepareContractWrite, contractActionError, ContractPreflightError } from '../fletch/transactions';

// Inside a signing flow with config from useConfig() and writeContractAsync
// from useWriteContract(). abi and functionName come from the compiled artifact.
const wallet = getAccount(config);
try {
  const request = await prepareContractWrite({ address, abi, functionName, args,
    account: wallet.address, value }, wallet);
  const current = getAccount(config);
  if (current.address !== wallet.address || current.chainId !== wallet.chainId) {
    throw new ContractPreflightError('Your wallet changed. Review this action again.');
  }
  const hash = await writeContractAsync(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new ContractPreflightError('The transaction reverted. Check the transaction details before retrying.');
  // Refresh authoritative reads and show the confirmed transaction here.
} catch (cause) {
  setError(contractActionError(cause));
}
```

Simulation checks one state snapshot. It does not prove sufficient gas funding,
wallet support, a mined transaction or the whole application flow. The caller
keeps the pending state through receipt confirmation and refreshes reads only
after success. Existing projects retain their editable foundations on image
upgrades; the new helper is supplied to newly prepared workspaces.

A dependent query with `enabled: false` can have `isPending: true` and
`fetchStatus: "idle"`. Use `isLoading` for an initial active request, and display
an empty list when the authoritative count is zero. Keep failures visible even
when a failed refresh retains older data.

The self-hosted Instrument Sans variable font and IBM Plex Mono regular font come
from Google's `google/fonts` repository, `ofl/instrumentsans` and `ofl/ibmplexmono`.
Their OFL license files ship beside them. Font bytes are part of the image/source
inventory; no font network requests happen during a build or page visit.

References: https://docs.reown.com/appkit/react/core/installation and
https://docs.reown.com/appkit/react/core/hooks (checked 8 September 2026).
Local browser fixtures do not prove a real wallet's WalletConnect pairing or
transaction signing. Validate those with the deployed app's allowlisted Reown ID.

Wallet compatibility sources (checked 8 September 2026):
- https://docs.phantom.com/ethereum-monad-testnet-base-and-polygon/detecting-the-provider
- https://help.phantom.com/articles/what-blockchain-networks-does-phantom-support-41372840389651
- https://help.phantom.com/articles/view-testnets-in-phantom-5997313271699
- https://docs.reown.com/appkit/react/core/options

## Version 2.0.4

The shared injected-wallet picker uses a native popover. It floats above the page,
closes on outside click or Escape, and keeps the header size stable. AppKit remains
the picker when a project ID is configured. `wallet.css` follows the app theme.

Optional `components.tsx` supplies Radix Dialog and Tabs with shadcn-style
composition and plain CSS tokens. Dialogs trap focus and return it to their trigger;
tabs support arrow keys. The agent may use these when they fit the design.
References: https://ui.shadcn.com/docs/components/radix/dialog and
https://ui.shadcn.com/docs/components/radix/tabs. These are adapted Fletch controls,
not a full shadcn installation.

Existing project source is preserved on image upgrades. To update an older wallet
picker, compare it with the current foundation and copy `wallet.tsx` and
`wallet.css` together while preserving intentional project customizations.
