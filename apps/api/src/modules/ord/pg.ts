/** The SQLSTATE of a database error (23505 unique, OR001, ...), or undefined. */
export function pgCode(error: unknown): string | undefined {
  return (error as { code?: unknown } | null)?.code as string | undefined
}
