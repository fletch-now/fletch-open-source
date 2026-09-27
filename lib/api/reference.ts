import "server-only";
import { APP_URL, RH_MAINNET_ID } from "@/lib/config";
import { API_TAGS, openApiDocument } from "@/lib/api/openapi";

// The written API reference is rendered from the same OpenAPI document Swagger
// UI reads, so the two never disagree. Public GETs also carry a live example:
// the real answer fetched from this server when the page is rendered, cut to a
// readable length, so a reader sees actual field names and values.

export interface ReferenceParameter {
  name: string;
  in: string;
  required: boolean;
  type: string;
  description: string | null;
  example: string | null;
}

export interface ReferenceOperation {
  method: string;
  path: string;
  summary: string;
  description: string | null;
  scopes: string[];
  requestBody: string | null;
  isPublic: boolean;
  parameters: ReferenceParameter[];
  responses: Array<{ status: string; description: string }>;
  exampleUrl: string | null;
  example: string | null;
}

export interface ReferenceSection {
  name: string;
  description: string;
  operations: ReferenceOperation[];
}

interface RawParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: { type?: string; format?: string; enum?: string[] };
  description?: string;
  example?: unknown;
}

interface RawOperation {
  summary?: string;
  description?: string;
  security?: Array<Record<string, string[]>>;
  // The scope a keyed operation needs. OpenAPI 3.1 allows no scopes on an
  // http scheme, so the document carries it as a vendor extension.
  "x-required-scope"?: string;
  parameters?: RawParameter[];
  responses?: Record<string, { description?: string }>;
  tags?: string[];
  requestBody?: unknown;
}

// Each public path gets one concrete URL a reader can open, with the
// placeholders filled in with values that exist.
const EXAMPLE_VALUES: Record<string, string> = {
  chainId: String(RH_MAINNET_ID), symbol: "TSLA", id: "…",
  address: "0x6bac06600d220ac5ac281ad1f504d2cf0f90f6e6",
};
const EXAMPLE_QUERY: Record<string, string> = {
  "/chains/{chainId}/assets": "?symbols=TSLA,AAPL",
  "/chains/{chainId}/events": "?limit=5",
  "/chains/{chainId}/assets/{symbol}/feed/rounds": "?limit=5",
  "/chains/{chainId}/assets/{symbol}/history": "?days=3",
  "/chains/{chainId}/assets/{symbol}/holders": "?limit=5",
  "/chains/{chainId}/assets/{symbol}/activity": "?days=3",
  "/chains/{chainId}/lookalikes": "?symbol=TSLA&limit=5",
  "/chains/{chainId}/bridge": "?limit=5",
  "/chains/{chainId}/control-plane": "?limit=5",
};
const EXAMPLE_MAX_CHARS = 1600;

function fillPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, (_match, name: string) => EXAMPLE_VALUES[name] ?? `{${name}}`);
}

function parameter(raw: RawParameter): ReferenceParameter {
  const type = raw.schema?.enum ? raw.schema.enum.join(" | ") : [raw.schema?.type, raw.schema?.format].filter(Boolean).join(", ") || "string";
  return { name: raw.name, in: raw.in, required: Boolean(raw.required), type, description: raw.description ?? null, example: raw.example === undefined ? null : String(raw.example) };
}

// Long arrays are cut to their first two entries so an example fits on a
// screen; the cut is marked, never silent.
function trimExample(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const kept = value.slice(0, 2).map((entry) => trimExample(entry, depth + 1));
    return value.length > 2 ? [...kept, `… ${value.length - 2} more`] : kept;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = depth > 3 ? "…" : trimExample(entry, depth + 1);
    }
    return out;
  }
  return value;
}

async function liveExample(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const text = JSON.stringify(trimExample(await response.json()), null, 2);
    return text.length > EXAMPLE_MAX_CHARS ? `${text.slice(0, EXAMPLE_MAX_CHARS)}\n…` : text;
  } catch {
    return null;
  }
}

// The stream is Server-Sent Events, not JSON; it gets a written example.
const STREAM_EXAMPLE = `: fletch registry events, chain 4663

retry: 2000
id: 2026-09-04T12:19:11.000Z

id: 2026-09-04T12:19:11.292Z|ev_feb6f0c2a5d94e1b8c7d3a21
event: token.halted
data: {"id":"ev_feb6…","kind":"token.halted","title":"SOUN trading halted at the issuer","symbol":"SOUN",…}`;

export async function apiReference(): Promise<ReferenceSection[]> {
  const sections = new Map<string, ReferenceOperation[]>();
  const base = openApiDocument.servers[0]?.url ?? `${APP_URL}/api/v1`;
  const document = openApiDocument as unknown as { paths: Record<string, Record<string, RawOperation>> };
  const pending: Array<Promise<void>> = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, raw] of Object.entries(item)) {
      const scope = raw["x-required-scope"];
      const scopes = scope ? [scope] : [];
      const isPublic = Array.isArray(raw.security) && raw.security.length === 0;
      const operation: ReferenceOperation = {
        method: method.toUpperCase(),
        path,
        summary: raw.summary ?? "",
        description: raw.description ?? null,
        scopes,
        requestBody: raw.requestBody ? JSON.stringify(raw.requestBody, null, 2) : null,
        isPublic,
        parameters: (raw.parameters ?? []).map(parameter),
        responses: Object.entries(raw.responses ?? {}).map(([status, response]) => ({ status, description: response.description ?? "" })),
        exampleUrl: isPublic && method === "get" && !fillPath(path).includes("{") ? `${base}${fillPath(path)}${EXAMPLE_QUERY[path] ?? ""}` : null,
        example: null,
      };
      if (path.endsWith("/events/stream")) {
        operation.example = STREAM_EXAMPLE;
      } else if (operation.exampleUrl && !path.startsWith("/apps")) {
        const url = operation.exampleUrl.replace(base, `${APP_URL}/api/v1`);
        pending.push(
          liveExample(url).then(function keep(example) {
            operation.example = example;
          }),
        );
      }
      const tag = raw.tags?.[0] ?? "Chains";
      sections.set(tag, [...(sections.get(tag) ?? []), operation]);
    }
  }
  await Promise.all(pending);
  return API_TAGS.filter((tag) => sections.has(tag.name)).map((tag) => ({ name: tag.name, description: tag.description, operations: sections.get(tag.name) ?? [] }));
}
