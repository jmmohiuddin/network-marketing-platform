/** The SQLSTATE of a database error (23505 unique, 23503 foreign key, P0002 no data, ...), or undefined. */
export function pgCode(error: unknown): string | undefined {
  return (error as { code?: unknown } | null)?.code as string | undefined
}

/** The DETAIL of a database error (guards name their refusal there), or undefined. */
export function pgDetail(error: unknown): string | undefined {
  return (error as { detail?: unknown } | null)?.detail as string | undefined
}
