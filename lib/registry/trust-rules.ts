// What a token is, in one vocabulary, decided from facts alone. Pages, the API,
// the watch daemon and the alert formatter all read their badge from here, so a
// token cannot be "community" on one surface and "verified" on another.
//
// The registry is the provenance stamp, not an allowlist: a token Robinhood
// does not list is shown as what it is, never hidden and never dressed up.

export type TrustLevel = "verified" | "listed" | "lookalike" | "community" | "unknown";

// Characters that render as another character in the faces a wallet or an
// explorer uses, which is the whole of the impersonation trick: a Cyrillic Е in
// "ТЕSLA" is a different code point and an identical picture. Folded before any
// comparison, in both directions, so the collision is found whichever side
// carries the trick.
//
// Deliberately conservative. Folding 5→S or 2→Z would catch a few more
// impersonators and would also label innocent tokens as lookalikes, and a false
// "this is NOT the verified token" is its own harm.
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic capitals that render as Latin capitals
  "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041a": "K", "\u041c": "M", "\u041d": "H", "\u041e": "O",
  "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0423": "Y", "\u0425": "X", "\u0405": "S", "\u0406": "I",
  "\u0408": "J",
  // Greek capitals that render as Latin capitals
  "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H", "\u0399": "I", "\u039a": "K",
  "\u039c": "M", "\u039d": "N", "\u039f": "O", "\u03a1": "P", "\u03a4": "T", "\u03a5": "Y", "\u03a7": "X",
  // One glyph, two code points, in almost every face
  "0": "O",
  "1": "I",
  "L": "I",
  "|": "I",
};

// Zero-width and bidirectional marks: invisible, and enough on their own to
// make two identical-looking strings compare unequal.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;

// The comparable form of a ticker or a name: invisible characters and accents
// removed, upper-cased, homoglyphs folded to their Latin twin, separators and
// the ticker dollar dropped. Cyrillic "\u0422SL\u0410" and "tsla" both become "TSIA".
//
// Upper-casing comes first, which is why the table below needs only capitals:
// a lowercase Cyrillic \u0441 upper-cases to \u0421 and folds from there. It also
// folds l/L/I/1 into I, and O/0 into O. A collision reports a matching label
// at another address; it is not a claim about the deployer's intent.
export function foldTicker(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const upper = value
    .normalize("NFKD")
    .replace(INVISIBLE, "")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  let folded = "";
  for (const character of upper) {
    folded += HOMOGLYPHS[character] ?? character;
  }
  return folded.replace(/[^A-Z0-9]/g, "");
}

export interface TokenFacts {
  // Robinhood's list carries this address.
  inRegistry: boolean;
  // The listed address holds bytecode and answers with the listed symbol and
  // decimals; the registry's own confirmed level.
  registryConfirmed: boolean;
  // Read from the token's own contract, null when the call did not answer.
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  // eth_getCode found something at the address. Null when nobody has looked.
  bytecodePresent: boolean | null;
  // What Robinhood's list calls this asset, for tokens on it. A bridged coin
  // is not a Stock Token, and a verdict that called it one would be wrong.
  assetType?: string | null;
}

export interface RegistryIdentity {
  verifiedAt: Date | null;
  symbol: string;
  name: string;
  decimals: number;
  onchainSymbol: string | null;
  onchainDecimals: number | null;
  assetType: string;
}

export function registryTokenFacts(asset: RegistryIdentity): TokenFacts {
  const confirmed = asset.verifiedAt !== null && asset.onchainSymbol !== null &&
    asset.onchainSymbol.toUpperCase() === asset.symbol.toUpperCase() && asset.onchainDecimals === asset.decimals;
  return { inRegistry: true, registryConfirmed: confirmed, symbol: asset.symbol, name: asset.name,
    decimals: asset.onchainDecimals, bytecodePresent: asset.verifiedAt !== null, assetType: asset.assetType };
}

export interface Verified {
  symbol: string;
  name: string;
  address: string;
}

// The verified token a candidate is pretending to be, or null. A token in the
// registry is never a lookalike of itself or of anything else.
export function collidesWith(facts: TokenFacts, verified: readonly Verified[]): Verified | null {
  if (facts.inRegistry) {
    return null;
  }
  const symbol = foldTicker(facts.symbol);
  const name = foldTicker(facts.name);
  if (!symbol && !name) {
    return null;
  }
  for (const entry of verified) {
    if (symbol && symbol === foldTicker(entry.symbol)) {
      return entry;
    }
    if (name && name === foldTicker(entry.name)) {
      return entry;
    }
  }
  return null;
}

// A token with a contract that answered is a token we can describe; one that
// answered nothing is one we cannot, and says so.
function resolved(facts: TokenFacts): boolean {
  return facts.bytecodePresent === true && facts.symbol !== null && facts.name !== null && facts.decimals !== null;
}

export function trustLevelFor(facts: TokenFacts, collision: Verified | null): TrustLevel {
  if (facts.inRegistry) {
    return facts.registryConfirmed ? "verified" : "listed";
  }
  if (collision) {
    return "lookalike";
  }
  return resolved(facts) ? "community" : "unknown";
}

export interface TrustVerdict {
  level: TrustLevel;
  // One line, the same words on every surface.
  label: string;
  detail: string;
  // Set only for a lookalike: the token this one is impersonating.
  impersonates: Verified | null;
}

const LABELS: Record<TrustLevel, string> = {
  verified: "Verified listing",
  listed: "Listed, not yet confirmed",
  lookalike: "Lookalike",
  community: "Community token",
  unknown: "Unknown token",
};

export function trustVerdict(facts: TokenFacts, verified: readonly Verified[]): TrustVerdict {
  return trustVerdictWith(facts, collidesWith(facts, verified));
}

// Scanner observations can establish a naming collision even when local
// metadata is unread. A beacon match never overrides the listing requirement.
export function trustVerdictWith(facts: TokenFacts, collision: Verified | null): TrustVerdict {
  const level = trustLevelFor(facts, collision);
  return { level, label: labelFor(level, facts), detail: detailFor(level, collision), impersonates: collision };
}

function labelFor(level: TrustLevel, facts: TokenFacts): string {
  if (level === "verified" && facts.assetType === "stock_token") {
    return "Verified Stock Token";
  }
  return LABELS[level];
}

function detailFor(level: TrustLevel, collision: Verified | null): string {
  switch (level) {
    case "verified":
      return "Robinhood lists this address, and the contract answers with the listed symbol and decimals.";
    case "listed":
      return "Robinhood lists this address. Fletch has not confirmed the contract against the listing yet.";
    case "lookalike":
      return collision
        ? `This address has a symbol or name matching ${collision.symbol}. The verified listing uses ${collision.address}. The contracts are different.`
        : "This address has a symbol or name matching a listed asset at another address.";
    case "community":
      return "The contract supplied its name, symbol and decimals. Its address is outside Robinhood's list.";
    default:
      return "Complete token metadata has not been recorded for this address.";
  }
}
