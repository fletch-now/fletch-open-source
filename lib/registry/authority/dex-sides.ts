// Which side of a pool is the thing being priced and which is the money.
// A listed Stock Token or bridged coin is the asset; USDG and WETH are quotes;
// anything Robinhood's list does not carry is a community token. Pure, so the
// rules can be tested without a database.

export interface SideAsset {
  id: string;
  address: `0x${string}`;
  assetType: string;
  decimals: number;
}

export interface Sides<A extends SideAsset = SideAsset> {
  // The listed asset, or null when the priced side is a community token.
  asset: A | null;
  // The address of the community token, when asset is null.
  token: string | null;
  quote: A | null;
}

const QUOTE_TYPES = new Set(["stablecoin", "wrapped_native"]);

function isQuote(asset: SideAsset | undefined): boolean {
  return asset !== undefined && QUOTE_TYPES.has(asset.assetType);
}

// Returns null for a pool the registry does not keep: two quotes against each
// other, or two unlisted tokens, neither of which prices anything a reader of
// this registry can use.
export function sidesOf<A extends SideAsset>(currency0: string, currency1: string, byAddress: Map<string, A>): Sides<A> | null {
  const a = byAddress.get(currency0);
  const b = byAddress.get(currency1);
  if (a && !isQuote(a)) {
    return { asset: a, token: null, quote: b ?? null };
  }
  if (b && !isQuote(b)) {
    return { asset: b, token: null, quote: a ?? null };
  }
  if (isQuote(a) && !b) {
    return { asset: null, token: currency1, quote: a ?? null };
  }
  if (isQuote(b) && !a) {
    return { asset: null, token: currency0, quote: b ?? null };
  }
  return null;
}

// The priced side's address and decimals, from the listed asset or the
// community token's own contract; null until the token has been read.
export interface PricedSide {
  address: string;
  decimals: number;
}
