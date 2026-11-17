import { z } from 'zod'

const id = z.guid()

/**
 * Outbox topics a tenant may subscribe a webhook endpoint to (API-33, PLAN B1 4). Payloads carry ids and minimal
 * data, never personal data (AC-INT1-6). A topic ships with the event that emits it.
 */
export const WEBHOOK_TOPICS = [
  {
    topic: 'compliance.snapshot.ready',
    description: 'A compliance report snapshot finished computing and its figures can be read.',
    payload: z.object({ snapshot_id: id, market_id: id }),
  },
  {
    topic: 'market.went_live',
    description: 'A market passed its launch checklist and sign-off and is now live.',
    payload: z.object({ market_id: id, code: z.string() }),
  },
  {
    topic: 'case.decided',
    description: 'A case was approved or rejected.',
    payload: z.object({ case_id: id, type: z.string(), decision: z.enum(['approved', 'rejected']) }),
  },
  {
    topic: 'order.ingested',
    description: 'An order was accepted (by API or a store connector) with its facts fixed.',
    payload: z.object({ order_id: id, market_id: id, source_system: z.string() }),
  },
  {
    topic: 'genealogy.changed',
    description: 'A sponsor or placement relationship was written (enrolment, change, correction, rule or migration).',
    payload: z.object({
      kind: z.enum(['sponsor', 'placement']), child_position_id: id, valid_from: z.string(),
      event_type: z.enum(['enrolment', 'change', 'correction', 'rule', 'migration']),
    }),
  },
] as const

export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number]['topic']

/** Sent by POST /v1/webhook-endpoints/:id/test to that endpoint only. */
export const TEST_TOPIC = 'webhook.test'

const TOPIC_SET: ReadonlySet<string> = new Set(WEBHOOK_TOPICS.map((entry) => entry.topic))

export function isWebhookTopic(value: string): value is WebhookTopic {
  return TOPIC_SET.has(value)
}

/** GET /v1/webhook-topics view. */
export function topicCatalogue() {
  return WEBHOOK_TOPICS.map(({ topic, description, payload }) => ({ topic, description, payload_fields: Object.keys(payload.shape) }))
}
