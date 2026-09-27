export interface TokenEvidence {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  blockNumber: string;
  checkedAt: string;
  sourceVerified: boolean;
  sourceVerifiedAt: string | null;
}

export type ListingState =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "suspended";

export interface AppListing {
  projectId: string;
  slug: string | null;
  title: string;
  summary: string;
  description: string;
  optedIn: boolean;
  state: ListingState;
  version: number;
  buildId: string | null;
  tokenContractId: string | null;
  token: TokenEvidence | null;
  featured: boolean;
  reviewNote: string | null;
  submittedAt: string | null;
  firstListedAt: string | null;
  updatedAt: string;
}

export interface PublicApp {
  slug: string;
  title: string;
  summary: string;
  description: string;
  liveUrl: string;
  token: TokenEvidence | null;
  featured: boolean;
  listedAt: string;
  updatedAt: string;
}

export interface OwnerListing {
  suggested?: { title: string; summary: string; description: string };
  project: { id: string; slug: string; name: string; liveUrl: string | null };
  listing: AppListing | null;
  public: boolean;
  needsReview: boolean;
  contracts: {
    id: string;
    address: string;
    chainId: number;
    buildId: string;
    recordedAt: string;
    published: boolean;
  }[];
}

export const LISTING_LABELS: Record<ListingState, string> = {
  draft: "Private draft",
  pending: "Awaiting review",
  approved: "In the directory",
  rejected: "Changes requested",
  suspended: "Hidden by an admin",
};
