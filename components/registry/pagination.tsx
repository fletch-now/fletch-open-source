import Link from "@/components/ui/navigation-link";
import type { ReactElement } from "react";

export function readPage(params: Record<string, string | string[] | undefined>): { page: number; pageSize: 25 | 50; offset: number } {
  const raw = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Number.isSafeInteger(raw) && raw > 0 && raw <= 1_000_000 ? raw : 1;
  const pageSize = params.size === "50" ? 50 : 25;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageHref(basePath: string, params: Record<string, string | string[] | undefined>, page: number, size: number, pageParam = "page"): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && key !== pageParam && key !== "size") query.set(key, value);
  }
  if (page > 1) query.set(pageParam, String(page));
  if (size === 50) query.set("size", "50");
  return query.size ? `${basePath}?${query}` : basePath;
}

interface PaginationProps {
  basePath: string;
  params: Record<string, string | string[] | undefined>;
  page: number;
  pageSize: number;
  total: number;
  anchor?: string;
  pageParam?: string;
  compact?: boolean;
}

export function RegistryPagination({ basePath, params, page, pageSize, total, anchor, pageParam = "page", compact = false }: PaginationProps): ReactElement {
  const href = (next: number, size: number) => `${pageHref(basePath, params, next, size, pageParam)}${anchor ? `#${anchor}` : ""}`;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 || page > pages ? 0 : (page - 1) * pageSize + 1;
  const last = first === 0 ? 0 : Math.min(page * pageSize, total);
  return (
    <nav aria-label="Table pages" className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink ${compact ? "mt-2 py-2" : "mt-4 rounded-xl border border-line bg-white px-4 py-3"}`}>
      <p className="tabular-nums">{first.toLocaleString("en-US")}–{last.toLocaleString("en-US")} of {total.toLocaleString("en-US")}</p>
      {!compact ? <div className="flex items-center gap-3">
        <span>Rows</span>
        {[25, 50].map(function sizeLink(size): ReactElement {
          return <Link key={size} href={href(1, size)} aria-current={pageSize === size ? "true" : undefined} className={pageSize === size ? "rounded-md bg-ink px-2.5 py-1.5 font-medium text-paper" : "rounded-md border border-line px-2.5 py-1.5 hover:bg-panel"}>{size}</Link>;
        })}
      </div> : null}
      <div className="ml-auto flex items-center gap-2">
        {page > 1 ? <Link rel="prev" href={href(Math.min(page - 1, pages), pageSize)} className="rounded-lg border border-line px-3 py-2 hover:bg-panel">Previous</Link> : <span aria-disabled="true" className="rounded-lg border border-line px-3 py-2 text-ink opacity-50">Previous</span>}
        {!compact ? <span className="tabular-nums">Page {page} of {pages}</span> : null}
        {page < pages ? <Link rel="next" href={href(page + 1, pageSize)} className="rounded-lg border border-line px-3 py-2 hover:bg-panel">Next</Link> : <span aria-disabled="true" className="rounded-lg border border-line px-3 py-2 text-ink opacity-50">Next</span>}
      </div>
    </nav>
  );
}
