import { z } from 'zod'

// Bodies and responses of the participant routes open to API keys (PLAN B2 2.2, 2.2.1). The routes parse requests with
// them and int/openapi.ts describes the key paths from them (publicParticipantSchemas).
const id = z.guid()
const instant = z.iso.datetime({ offset: true })
export const SIGNAL_KINDS = ['identity_ref', 'payment_fingerprint', 'address', 'device_id'] as const
export type SignalKind = (typeof SIGNAL_KINDS)[number]

export const positionRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, 'must be a position reference')
export const typeCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/, 'must be a type code')
const leg = z.string().regex(/^[1-9][0-9]?$/, 'must be a leg number 1..99').describe('Placement leg, "1".."<width>"')
const signalValue = z.string().trim().min(1).max(500)

const signalFields = Object.fromEntries(SIGNAL_KINDS.map((kind) => [kind, signalValue.optional()])) as
  Record<SignalKind, z.ZodOptional<typeof signalValue>>
export const signalsBody = z
  .strictObject(signalFields)
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), 'send at least one signal')
  .describe('Raw values are hashed (HMAC-SHA256) on arrival and never stored')

export const placementInput = z.union([
  z.strictObject({ auto: z.literal(true), position_ref: positionRef }),
  z.strictObject({ position_ref: positionRef, leg: leg.optional() }),
])
export const sponsorInput = z.strictObject({ position_ref: positionRef })
export const positionBody = z.strictObject({
  position_ref: positionRef.optional(),
  brand_id: id.optional(),
  sponsor: sponsorInput.optional(),
  placement: placementInput.optional(),
})

const evidence = z.strictObject({ channel: z.string().trim().min(1).max(50), reference: z.string().trim().min(1).max(200) })
const contact = z.strictObject({
  email: z.email().max(320).optional(),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{5,40}$/, 'must be a phone number').optional(),
  address: z.string().trim().min(1).max(500).optional(),
})

export const enrolmentBody = z.strictObject({
  external_ref: z.string().regex(/^[\x21-\x7e]{1,100}$/, 'printable ASCII without spaces, 1..100'),
  market: z.string().regex(/^[A-Z]{2}$/, 'must be the market\'s ISO code'),
  type_code: typeCode,
  account_type: z.enum(['individual', 'joint', 'entity']),
  display_name: z.string().trim().min(1).max(200).optional(),
  contact: contact.optional(),
  enrolled_at: instant.optional().describe('Default now; not in the future, not before the end of the latest committed period'),
  ...positionBody.shape,
  agreement: z.strictObject({ version_id: id, accepted_at: instant, evidence: evidence.optional() }).optional(),
  signals: signalsBody.optional(),
})

export const typeChangeBody = z.strictObject({
  type_code: typeCode,
  valid_from: instant.optional().describe('Default now; never in the past'),
  reason: z.string().trim().min(1).max(500),
})

export const acceptanceBody = z.strictObject({ agreement_version_id: id, accepted_at: instant, evidence: evidence.optional() })

const positionView = z.object({ id, position_ref: z.string(), status: z.enum(['pending', 'active', 'suspended', 'terminated']) })
const placementView = z.object({ parent_position_id: id, leg: z.string().nullable(), auto: z.boolean() })

export const enrolmentResponse = z.object({
  participant: z.object({ id, external_ref: z.string(), status: z.enum(['active', 'merged']) }),
  position: positionView.nullable(),
  placement: placementView.nullable(),
  servicing: z.object({ position_id: id }).nullable(),
  duplicate_case_id: id.nullable(),
})
export const positionResponse = z.object({ position: positionView, placement: placementView.nullable() })
export const typesResponse = z.object({
  types: z.array(z.object({
    type: z.object({ id, code: z.string(), name: z.string() }), valid_from: z.iso.datetime(), valid_to: z.iso.datetime().nullable(),
  })),
})
export const acceptanceResponse = z.object({ id, agreement_version_id: id, accepted_at: z.iso.datetime() })
export const signalsResponse = z.object({ added: z.number().int().nonnegative(), duplicate_case_id: id.nullable() })

export type EnrolmentBody = z.infer<typeof enrolmentBody>
export type PositionBody = z.infer<typeof positionBody>
export type PlacementInput = z.infer<typeof placementInput>
export type SignalsBody = z.infer<typeof signalsBody>

/** PLAN B2 4.1: the key-open participant schemas for the OpenAPI document. */
export const publicParticipantSchemas = {
  enrolmentBody, enrolmentResponse, typeChangeBody, typesResponse, positionBody, positionResponse, acceptanceBody,
  acceptanceResponse, signalsBody, signalsResponse,
}
