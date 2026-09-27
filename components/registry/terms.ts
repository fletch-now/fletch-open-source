// Shared definitions for column help, token details and the registry glossary.
export const REGISTRY_TERMS = {
  feedPrice: "A reference price in USD reported by the token's on-chain price feed. Fletch checks the feed every minute. The feed's own update time can be older than that check. Open the token to compare it with a DEX pool price and see the recorded feed update.",
  multiplier: "Converts a token balance into its share-equivalent amount. For example, 10 token units with a multiplier of 2 represent 20 share-equivalent units. A stock split can change the multiplier.",
  identity: "Records which address checks passed: the issuer's listing, deployed contract code, and matching symbol and decimals. Open the badge for the exact trust definition. Price and market readings have their own sources and times.",
  contract: "The token's unique address on this chain. Different contracts can use the same name or ticker. Follow this address to inspect the contract before using the token.",
  lookalikes: "Other contracts using a matching listed ticker or name. The count links to those addresses and the matching evidence. A name collision alone does not establish fraud.",
  state: "The latest recorded pause, identity and feed checks. Each check has its own age. A transfer can still depend on the sender, receiver and other contract rules; open the token for its full state.",
  dexPrice: "A price calculated from a DEX pool's recorded state. The pool, quote currency and observation time identify its source. The amount you receive for a trade also depends on its size, fees and available liquidity.",
  premium: "The percentage difference between the selected DEX pool price and the feed price. Positive means the pool price is higher; negative means it is lower. Both prices need a usable observation.",
  pool: "A place where two tokens are traded. One token can have several pools with different counterpart tokens and fees. Open a pool to inspect the exact market used for a reading.",
  volume: "The dollar value assigned to recorded swaps over the stated 24-hour window. In the token table it covers the selected pool only. Open the source details for the window and valuation method; a complete indexed window is required.",
  swaps: "The number of recorded swap events in a complete 24-hour window for this pool. One transaction can contain several swaps. An unavailable count means coverage or freshness is incomplete.",
  marketCap: "An estimate calculated as recorded total supply minus balances at the tracked burn addresses, multiplied by this pool's token price. The supply and price can have different observation times. Treasury and locked balances may still be included.",
  v3Holdings: "The dollar value of the quote token held by this V3 pool, read from its token balance. It includes fees. It describes quote-side holdings; actual trade execution also depends on how liquidity is positioned.",
  v4Depth: "An estimate of quote-token value crossed by a 1% price move using this V4 pool's recorded state. V4 funds sit in a shared manager, so this is a per-pool estimate rather than a separate pool balance. Compare it with other V4 estimates.",
  freshness: "Checked tells you when Fletch read a source. Updated tells you when that source says its value changed. A new check can return an older value. Unavailable means a required value or usable observation is missing.",
} as const;
