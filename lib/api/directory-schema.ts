export const DirectoryTokenSchema = {
  type: ["object", "null"],
  description:
    "Metadata read from a project-recorded contract at a pinned block. This check is not a security audit. Source verification is a separate chain explorer observation.",
  properties: {
    chainId: { type: "integer", enum: [4663, 46630] },
    address: { type: "string" },
    name: { type: "string" },
    symbol: { type: "string" },
    decimals: { type: "integer" },
    totalSupply: {
      type: "string",
      description: "Raw integer units at blockNumber; apply decimals.",
    },
    blockNumber: { type: "string" },
    checkedAt: { type: "string", format: "date-time" },
    sourceVerified: { type: "boolean" },
    sourceVerifiedAt: { type: ["string", "null"], format: "date-time" },
  },
  required: [
    "chainId",
    "address",
    "name",
    "symbol",
    "decimals",
    "totalSupply",
    "blockNumber",
    "checkedAt",
    "sourceVerified",
    "sourceVerifiedAt",
  ],
} as const;

export const PublicAppSchema = {
  type: "object",
  properties: {
    slug: {
      type: "string",
      description: "Current canonical directory slug, separate from the hosted app's hostname. Older slug reads return this current record only while it remains public. Its page is /published/{slug}.",
    },
    title: { type: "string" },
    summary: { type: "string" },
    description: { type: "string" },
    liveUrl: { type: "string", format: "uri" },
    token: DirectoryTokenSchema,
    featured: { type: "boolean" },
    listedAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "slug",
    "title",
    "summary",
    "description",
    "liveUrl",
    "token",
    "featured",
    "listedAt",
    "updatedAt",
  ],
} as const;
