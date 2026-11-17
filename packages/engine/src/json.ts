// JSON codec for engine data stored outside the process (PLAN B3 section 1.5): run snapshots, golden datasets,
// compiled plan versions. bigint travels as a decimal string; object keys are written in sorted order so equal values
// give equal text. Parsing turns the strings under keys ending `Minor` or `Us` back into bigint: that covers every
// bigint of the engine inputs (types.ts conventions). Stored outputs (traces, cap applications) keep their other
// bigints (raw, base, ...) as strings: they are for display and SQL only.

const BIGINT_KEY = /(Minor|Us)$/

/**
 * Two passes: the first writes bigint as decimal strings and collects every key name, the second writes every object
 * with its keys in sorted order (a key-list replacer orders the keys of every nested object as listed).
 */
export function stringifyEngineJson(value: unknown): string {
  const keys = new Set<string>()
  const plain = JSON.stringify(value, function (this: unknown, key, item: unknown) {
    // Array indices are not object keys: a key-list replacer never filters array elements, and collecting them made this O(n^2).
    if (!Array.isArray(this)) keys.add(key)
    return typeof item === 'bigint' ? item.toString() : item
  })
  return JSON.stringify(JSON.parse(plain), [...keys].sort())
}

export function parseEngineJson<T>(text: string): T {
  return JSON.parse(text, (key, value: unknown) => {
    if (!BIGINT_KEY.test(key)) return value
    if (typeof value === 'string') return BigInt(value)
    if (Array.isArray(value)) return value.map((item: unknown) => (typeof item === 'string' ? BigInt(item) : item))
    return value
  }) as T
}
