// Account handles. Every wallet gets a readable name at sign-up — an English
// wood-and-field pairing plus two digits — so the dashboard and the admin list can
// talk about a person without printing a bare address.

const ADJECTIVES = [
  "brisk", "mossy", "amber", "quiet", "swift", "wild", "green", "misty",
  "bold", "lunar", "oaken", "reedy", "dusky", "fabled", "keen", "sylvan",
];

const NOUNS = [
  "otter", "wren", "fox", "badger", "heron", "stag", "hare", "kestrel",
  "rook", "vole", "finch", "boar", "owl", "pike", "marten", "lark",
];

function hashOf(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function walletHandle(seed: string): string {
  const hash = hashOf(seed);
  // Each field reads a different slice of the hash's bits (shifted apart) so
  // the three modulo picks don't all key off the same low bits and correlate.
  const adjective = ADJECTIVES[hash % ADJECTIVES.length];
  const noun = NOUNS[(hash >>> 4) % NOUNS.length];
  const digits = 10 + ((hash >>> 9) % 90);
  return `${adjective}-${noun}-${digits}`;
}
