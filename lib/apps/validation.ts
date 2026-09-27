import { z } from "zod";
import { validListingSlug } from "./slug";

function cleanText(value: string): string {
  return value.normalize("NFC").trim();
}

const plain = z
  .string()
  .transform(cleanText)
  .refine(function safe(text) {
    return !/[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(
      text,
    );
  }, "Use plain text without HTML or hidden control characters.");
const singleLine = plain.transform(function collapseWhitespace(text) {
  return text.replace(/\s+/gu, " ");
});

function minimumCharacters(count: number): (text: string) => boolean {
  return function enough(text: string): boolean {
    return Array.from(text).length >= count;
  };
}

export const ListingInput = z.object({
  slug: z.string().trim().refine(validListingSlug, "Use 3 to 60 lowercase letters, numbers and single hyphens. Choose a name without the reserved forge- prefix.").optional(),
  title: singleLine.pipe(
    z.string().refine(minimumCharacters(3), "Use at least 3 characters for the app name.").max(60),
  ),
  summary: singleLine.pipe(
    z.string().refine(minimumCharacters(20), "Describe the app in at least 20 characters.").max(160),
  ),
  description: plain.pipe(
    z
      .string()
      .refine(minimumCharacters(60), "Add at least 60 characters explaining how people use the app.")
      .max(2400),
  ),
  tokenContractId: z.string().min(1).max(100).nullable(),
  version: z.number().int().min(0),
  action: z.enum(["save", "submit"]),
});

export type ListingInput = z.infer<typeof ListingInput>;

export function isTokenAbi(abi: unknown): boolean {
  if (!Array.isArray(abi)) return false;
  const functions = new Set(
    abi
      .filter(function fn(item) {
        return item && typeof item === "object" && item.type === "function";
      })
      .map(function name(item) {
        return item.name;
      }),
  );
  return [
    "name",
    "symbol",
    "decimals",
    "totalSupply",
    "balanceOf",
    "transfer",
  ].every(function present(name) {
    return functions.has(name);
  });
}

export function directoryQuery(params: URLSearchParams): {
  q: string;
  page: number;
} {
  const raw = params.get("page") ?? "1";
  const page = /^\d{1,4}$/.test(raw) ? Number(raw) : 1;
  return {
    q: (params.get("q") ?? "").trim().slice(0, 80),
    page: Math.max(1, Math.min(1000, page)),
  };
}
