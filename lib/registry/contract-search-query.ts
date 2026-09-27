export interface ContractSearchQuery {
  text: string;
  mode: "text" | "address" | "fragment" | "pool" | "isin";
  terms: string[];
  prefix: string;
  suffix: string;
}

export function normalizeContractQuery(value: string): string {
  let text = value.trim().normalize("NFKC");
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const address = url.pathname.match(/\/(?:token|address|pool)\/(0x[0-9a-f]{40}(?:[0-9a-f]{24})?)(?:\/|$)/i)?.[1];
      if (address) text = address;
    } catch { /* Invalid URLs remain literal search text. */ }
  }
  return text.replace(/^(?:eip155:)?4663:/i, "").replace(/^\$/, "").replace(/\s+/g, " ").trim();
}

export function parseContractQuery(value: string): ContractSearchQuery {
  const text = normalizeContractQuery(value).toLowerCase();
  const fragment = text.match(/^(0x[0-9a-f]{4,38})(?:…|\.{3})([0-9a-f]{4,38})$/);
  let mode: ContractSearchQuery["mode"] = "text";
  if (/^0x[0-9a-f]{40}$/.test(text)) mode = "address";
  else if (/^0x[0-9a-f]{64}$/.test(text)) mode = "pool";
  else if (fragment || /^0x[0-9a-f]{4,39}$/.test(text)) mode = "fragment";
  else if (/^[a-z]{2}[a-z0-9]{9}[0-9]$/.test(text)) mode = "isin";
  return { text, mode, terms: text.split(/[^\p{L}\p{N}%_\\]+/u).filter(Boolean).slice(0, 8), prefix: fragment?.[1] ?? text, suffix: fragment?.[2] ?? "" };
}

export function escapeSearchLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function matchesContractText(values: Array<string | null | undefined>, value: string): boolean {
  const query = parseContractQuery(value);
  if (!query.text) return true;
  const haystack = values.filter(Boolean).join(" ").normalize("NFKC").toLowerCase();
  if (query.mode === "fragment") return values.some((item) => item?.toLowerCase().startsWith(query.prefix) && item.toLowerCase().endsWith(query.suffix));
  return query.terms.length > 0 && query.terms.every((term) => haystack.includes(term));
}
