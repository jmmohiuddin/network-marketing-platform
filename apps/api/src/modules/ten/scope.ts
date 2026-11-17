export function inScope(scope: readonly string[] | null, marketId: string): boolean {
  return scope === null || scope.includes(marketId)
}
