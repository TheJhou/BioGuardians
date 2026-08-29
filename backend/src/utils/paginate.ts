export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export function paginate<T>(
  rows: T[],
  page: number,
  perPage: number,
  total: number
): PaginatedResponse<T> {
  return {
    data: rows,
    total,
    page,
    per_page: perPage,
    total_pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export function getPaginationParams(query: { page?: unknown; per_page?: unknown }): { page: number; perPage: number; offset: number } {
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.per_page) || 20));
  const offset = (page - 1) * perPage;
  return { page, perPage, offset };
}
