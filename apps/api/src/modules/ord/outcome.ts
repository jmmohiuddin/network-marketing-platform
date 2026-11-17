/** What one processing attempt of an order or event produced (refusals are thrown as Refusal). */
export type Outcome =
  | { readonly state: 'processed'; readonly result: Readonly<Record<string, string>>; readonly body: unknown }
  | { readonly state: 'held'; readonly reason: 'UNKNOWN_SKU' | 'ORDER_NOT_FOUND'; readonly ref: string; readonly skus?: readonly string[] }

/** Ids the attempt writes under: the inbound event (exists before processing) and the order or event to create. */
export interface AttemptRefs {
  readonly inboundId: string
  readonly targetId: string
  readonly hash: Buffer
}
