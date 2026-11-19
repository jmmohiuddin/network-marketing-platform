// Memory layout of run outputs (S-1, D-B4-22): sub-objects equal for many rows (empty arrays, rank references, a
// rule's tree reference) are one shared frozen copy instead of one per row. The output values are unchanged; a
// consumer that tries to mutate a shared copy fails loudly instead of changing other rows.

export const EMPTY: readonly never[] = Object.freeze([])

/** Returns the one frozen value made for each key (make runs once per key). */
export function interner<T extends object>(): (key: string, make: () => T) => T {
  const seen = new Map<string, T>()
  return (key, make) => {
    let value = seen.get(key)
    if (value === undefined) {
      value = Object.freeze(make())
      seen.set(key, value)
    }
    return value
  }
}

/** The array itself when non-empty, else the shared EMPTY. */
export const orEmpty = <T>(items: readonly T[]): readonly T[] => (items.length === 0 ? EMPTY : items)
