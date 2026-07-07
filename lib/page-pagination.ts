import {
  buildPaginationMeta,
  parsePagination,
  type PaginationMeta,
  type PaginationParams,
} from "./pagination";

export type { PaginationMeta, PaginationParams };

/** Parses page/limit from Next.js server component searchParams. */
export function parsePageSearchParams(
  searchParams: { page?: string; limit?: string },
  options?: { defaultLimit?: number; maxLimit?: number },
): PaginationParams {
  const url = new URL("http://local");
  if (searchParams.page) url.searchParams.set("page", searchParams.page);
  if (searchParams.limit) url.searchParams.set("limit", searchParams.limit);
  return parsePagination(url, options);
}

export { buildPaginationMeta };
