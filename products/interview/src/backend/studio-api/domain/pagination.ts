export function answerPagination(
  pageParam: string | undefined,
  pageSizeParam: string | undefined,
) {
  if (pageParam === undefined && pageSizeParam === undefined) {
    return { kind: "all" } as const;
  }
  const page = Number(pageParam ?? 1);
  const pageSize = Number(pageSizeParam ?? 20);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    return { kind: "invalid" } as const;
  }
  return { kind: "page", page, pageSize } as const;
}
