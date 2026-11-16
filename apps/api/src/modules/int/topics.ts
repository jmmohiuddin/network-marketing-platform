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
