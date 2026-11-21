import type { ApiModule } from '../../lib/module.js'
import { registerOrderRoutes } from './routes.js'
import { registerIngestRoutes } from './routes-ingest.js'

/**
 * Orders (ORD, FR-ORD-001..005): order and event ingestion by API key with natural-key deduplication, held and
 * rejected inbound events, product volumes, attribution at ingestion and the late-transaction queue; V1-A: conversion
 * of orders in another currency at acceptance (FR-FIN-007), subscription and dispute events (FR-ORD-006).
 */
export const ordModule: ApiModule = {
  name: 'ord',
  register(app) {
    registerIngestRoutes(app)
    registerOrderRoutes(app)
  },
}

export { publicOrderSchemas, orderInput, eventInput, type OrderInput, type EventInput, type HoldReason } from './schemas.js'
// Connector facade (INT, D-B2-14): connector payloads are mapped to the same inputs and received like API writes.
export { receive, recordRejected, payloadHash, type IngestContext, type Submission } from './inbound.js'
// LED facade (PLAN V1-A 4.1): an approved FX batch releases the orders held for its pairs.
export { releaseHeld } from './inbound.js'
export { Refusal } from './refusal.js'
export { creditingEvent } from './order-checks.js'
// SC-31 list registry for RPT saved views (D-B6-08).
export { ORDER_COLUMNS, ORDER_SORTS, orderFilters } from './order-list.js'
