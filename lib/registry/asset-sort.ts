export type AssetSort = "symbol" | "name" | "type" | "address" | "verified" | "multiplier" | "price" | "lookalikes" | "state" | "newest" | "holders" | "float";
export type AssetSortOrder = "asc" | "desc";

export const SORT_LABEL: Record<AssetSort, string> = {
  symbol: "Symbol",
  name: "Name",
  type: "Type",
  address: "Contract",
  verified: "Identity",
  multiplier: "Multiplier",
  price: "Feed price",
  lookalikes: "Lookalikes",
  state: "State",
  newest: "First listed",
  holders: "Holders",
  float: "Float",
};

export function isAssetSort(value: string): value is AssetSort {
  return Object.hasOwn(SORT_LABEL, value);
}

export function defaultAssetSortOrder(sort: AssetSort): AssetSortOrder {
  return ["symbol", "name", "type", "address", "state"].includes(sort) ? "asc" : "desc";
}

export function parseAssetSortQuery(params: URLSearchParams): { sort: AssetSort; order: AssetSortOrder } | { error: string } {
  const sort = params.get("sort") ?? "symbol";
  if (!isAssetSort(sort) || params.getAll("sort").length > 1) {
    return { error: "Unknown or repeated asset sort" };
  }
  const order = params.get("order") ?? defaultAssetSortOrder(sort);
  if (!["asc", "desc"].includes(order) || params.getAll("order").length > 1) {
    return { error: "Asset order must be asc or desc and appear once" };
  }
  return { sort, order: order as AssetSortOrder };
}
