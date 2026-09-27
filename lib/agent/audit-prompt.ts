// The pre-mainnet audit, sent as a follow-up prompt into the app's own agent
// session. It runs through the same pipeline as any build: whatever the agent
// changes is compiled, tested and scanned by Slither again before the result
// is shown, so the report below is checked by the toolchain, not taken on trust.
// Kept under the 2,000-character prompt limit on purpose.
export const MAINNET_AUDIT_PROMPT = `Audit every contract in contracts/ for mainnet and fix what you find. Work through this list, one item at a time, reading the code for each:
1. Access control: every state-changing function that is not for everyone checks onlyOwner or a role; the owner is the constructor's initialOwner, never msg.sender; two-step ownership transfer; no function lets a caller escalate.
2. Reentrancy: checks-effects-interactions everywhere; a guard on every function that sends ETH or calls another contract; no state read after an external call.
3. Value handling: call for ETH with the result required; pull payments over push; no locked funds (every deposit has a withdrawal path); safe ERC20 handling for tokens that return no bool or revert on transfer, including Stock Tokens, which can be paused or blocklisted by the issuer.
4. Arithmetic: rounding direction favours the contract; no division before multiplication; no truncation of user amounts; uiMultiplier-aware maths for Stock Tokens.
5. Inputs: zero-address, zero-amount and out-of-range checks; no unbounded loops over caller-controlled arrays; no reliance on block.timestamp for anything finer than minutes.
6. Front-running and replay: commit-reveal or slippage bounds where ordering matters; nonces on any signed message; chain id in every signature domain.
7. Forbidden: tx.origin, selfdestruct, delegatecall, inline assembly, unprotected initializers, floating pragma.
8. Emergency: a pause the owner can flip that stops deposits but never withdrawals.
9. Events on every state change; explicit visibility on everything.
For each item write the finding, the fix and a test in test/ that fails before and passes after. Change only what a finding requires; keep the constructor signature. Run forge build and forge test until both pass. Finish with a table: item, severity (high/medium/low/none), status (fixed/no issue/left, with why). Say plainly what an auditor would still need to look at.`;
