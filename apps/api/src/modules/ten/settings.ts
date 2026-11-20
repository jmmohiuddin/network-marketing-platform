import type { Tx } from '@nmp/db'
import { z } from 'zod'
import type { Permission } from '../../lib/permissions.js'

/** A non-negative bigint in minor units, as a decimal string of at most 18 digits (fits bigint; no floats, OI-7). */
const bigintString = z.string().regex(/^(0|[1-9]\d{0,17})$/, 'must be a non-negative whole number of at most 18 digits as a string')

const positiveBigintString = bigintString.refine((value) => BigInt(value) > 0n, 'must be greater than zero')

const breachContact = z.strictObject({
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(200),
  email: z.email().max(320),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{5,40}$/, 'must be a phone number'),
})

export interface SettingDefinition<S extends z.ZodType = z.ZodType> {
  readonly schema: S
  /** Any one of these lets a user read the value; writing always needs settings.manage. */
  readonly readPermissions: readonly Permission[]
  /** Security-relevant: writing needs a fresh second factor (SEC-20). */
  readonly stepUp: boolean
  /**
   * D-B2-08: the permission (all markets) of whoever approves a change, or null when the key is written directly.
   * migration 0204's approval_setting_keys() lists exactly the keys where it is set.
   */
  readonly approverPermission: Permission | null
  /** D-B3-06: kept so stored values still parse; writes are refused (SETTING_RETIRED). */
  readonly retired?: boolean
  /** BUG-129: PUT {value: null} writes a version without the key (unset). */
  readonly clearable?: boolean
}

const COMPLIANCE_READERS: readonly Permission[] = ['settings.manage', 'compliance.read']
const POLICY_READERS: readonly Permission[] = ['settings.manage', 'settings.approve']
const ORDER_READERS: readonly Permission[] = ['settings.manage', 'order.read']
const PAYOUT_READERS: readonly Permission[] = [...POLICY_READERS, 'payout.prepare']
const SIGNAL_KINDS = ['identity_ref', 'payment_fingerprint', 'address', 'device_id'] as const
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length

/**
 * Every tenant setting key. None has a default (DEC-14, E-ADR-11): an unset threshold is null and the
 * report that needs it omits the indicator and says so.
 */
export const SETTINGS = {
  /** R4: personal volume (minor units) that makes an earner active. */
  'compliance.active_pv_minor': { schema: bigintString, readPermissions: COMPLIANCE_READERS, stepUp: false, approverPermission: null },
  /** R4: rank name -> personal volume threshold (minor units). */
  'compliance.rank_thresholds_pv_minor': {
    schema: z.record(z.string().trim().min(1).max(64), bigintString).refine((value) => Object.keys(value).length > 0, 'needs at least one rank'),
    readPermissions: COMPLIANCE_READERS,
    stepUp: false,
   
    approverPermission: null,
  },
  /** R4: day of month from which an order counts as late (end-of-period threshold orders). */
  'compliance.late_order_day': {
    schema: z.number().int().min(1).max(31), readPermissions: COMPLIANCE_READERS, stepUp: false, approverPermission: null,
  },
  /** R2: personal-use share that flags an earner, as an exact fraction (numerator <= denominator). */
  'compliance.personal_share_flag': {
    schema: z
      .strictObject({ numerator: bigintString, denominator: positiveBigintString })
      .refine((ratio) => BigInt(ratio.numerator) <= BigInt(ratio.denominator), 'numerator must not exceed denominator'),
    readPermissions: COMPLIANCE_READERS,
    stepUp: false,
   
    approverPermission: null,
  },
  /** FR-PRV-004: breach-notification contacts (at least one). */
  'privacy.breach_contacts': {
    schema: z.array(breachContact).min(1).max(20),
    readPermissions: ['settings.manage'],
    stepUp: true,
   
    approverPermission: null,
  },
  /** BR-MNY-02: rounding of money amounts. Unset = the platform rule half-up applies (engine, B3). */
  'money.rounding_mode': {
    schema: z.enum(['half_up', 'half_even']), readPermissions: POLICY_READERS, stepUp: false, approverPermission: 'settings.approve',
  },
  /** D-B4-06, retired: the clawback policy is each bonus's reversal_policy on the plan version. */
  'money.clawback_policy': {
    schema: z.strictObject({ default: z.enum(['order_line', 'restatement']) }),
    readPermissions: POLICY_READERS,
    stepUp: false,
    approverPermission: 'settings.approve',
    retired: true,
  },
  /** BR-PLN-04: days of notice before a plan version activates. */
  'plan.activation_notice_days': {
    schema: z.number().int().min(0).max(365), readPermissions: POLICY_READERS, stepUp: false, approverPermission: null, clearable: true,
  },
  // PLAN B2 section 2.1: none has a default (DEC-14); each unset key's consequence is stated where it is read.
  /** FR-PAR-003 (D-B2-10): which hashed signals match, how many must, and whether a match holds activation. */
  'participants.duplicate_matching': {
    schema: z
      .strictObject({
        signals: z.array(z.enum(SIGNAL_KINDS)).min(1).max(SIGNAL_KINDS.length).refine(unique, 'signals must be unique'),
        min_matches: z.number().int().min(1),
        hold_activation: z.boolean(),
      })
      .refine((value) => value.min_matches <= value.signals.length, 'min_matches must not exceed the number of signals'),
    readPermissions: ['settings.manage', 'case.duplicate.read'],
    stepUp: false,
   
    approverPermission: null,
  },
  /** FR-CRM-002 (D-B2-16): where a terminated position's customers go, and after how many days. */
  'customers.reassignment_rule': {
    schema: z.strictObject({
      rule: z.enum(['sponsor', 'company', 'customer_choice']),
      notice_days: z.number().int().min(0).max(90),
    }),
    readPermissions: ['settings.manage', 'servicing.manage'],
    stepUp: false,
   
    approverPermission: null,
  },
  /** D-B2-12: the event whose time credits an order. */
  /** Retired by D-B6-05: the crediting event lives on the plan version (plan_crediting_event); stored values still parse. */
  'orders.crediting_event': {
    schema: z.enum(['paid', 'fulfilled']), readPermissions: ORDER_READERS, stepUp: false,
    approverPermission: null, retired: true,
  },
  /** FR-ORD-003: an order without a purpose is flagged purpose_missing. */
  'orders.purpose_required': {
    schema: z.boolean(), readPermissions: ORDER_READERS, stepUp: false, approverPermission: null,
  },
  /** D-B2-13: attribution hint precedence. */
  'orders.attribution_precedence': {
    schema: z.array(z.enum(['link', 'code', 'servicing'])).min(1).max(3).refine(unique, 'precedence entries must be unique'),
    readPermissions: ORDER_READERS,
    stepUp: false,
   
    approverPermission: null,
  },
  /** FR-ORD-001: the type code of buyers created by ingestion. */
  'orders.new_buyer_type': {
    schema: z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/, 'must be a participant type code'),
    readPermissions: ORDER_READERS,
    stepUp: false,
   
    approverPermission: null,
  },
  /** D-B2-17: how a restocking fee affects the volume a return reverses. */
  'orders.restocking_fee_volume_effect': {
    schema: z.enum(['none', 'proportional']), readPermissions: ORDER_READERS, stepUp: false,
    approverPermission: null,
  },
  /** FR-INT-002: lag after which a source is behind, then failing. */
  'integrations.sync_health': {
    schema: z
      .strictObject({
        behind_after_minutes: z.number().int().min(1).max(10_080),
        failing_after_minutes: z.number().int().min(2).max(20_160),
      })
      .refine((value) => value.failing_after_minutes > value.behind_after_minutes, 'failing_after_minutes must exceed behind_after_minutes'),
    readPermissions: ['settings.manage', 'integration.read'],
    stepUp: false,
   
    approverPermission: null,
  },
  /** FR-GEN-006 (D-B2-08): named downline depth and contact visibility; a DPO approves every change. */
  'genealogy.visibility_policy': {
    schema: z.strictObject({ named_depth: z.number().int().min(1).max(20), contact_for_personally_sponsored: z.boolean() }),
    readPermissions: ['settings.manage', 'privacy.manage', 'genealogy.read'],
    stepUp: false,
   
    approverPermission: 'privacy.manage',
  },
  /** D-B2-20, retired by D-B3-06: the width now lives on the plan version; read only as the legacy fallback. */
  'genealogy.placement_width': {
    schema: z.number().int().min(2).max(20), readPermissions: ['settings.manage', 'genealogy.read'], stepUp: false,
    approverPermission: null, retired: true,
  },
  /** D-B3-11: a result line at or above this amount is a blocking review exception; unset = the check is reported as not configured. */
  'runs.exception_thresholds': {
    schema: z.strictObject({ large_line_minor: bigintString }),
    readPermissions: ['run.review', 'settings.manage'],
    stepUp: false,
    approverPermission: null,
  },
  // PLAN B4 D-B4-18: none has a default (DEC-14); an unset key refuses the action that needs it (SETTING_NOT_CONFIGURED).
  /** FR-PAY-007, AC-47.1: per market id, the minimum payable paid (payable >= minimum, MONEY C-13) and whether a payee needs a tax profile. */
  'payouts.market_policy': {
    schema: z
      .record(z.uuid(), z.strictObject({ minimum_payout_minor: bigintString, tax_profile_required: z.boolean() }))
      .refine((value) => Object.keys(value).length > 0, 'needs at least one market'),
    readPermissions: PAYOUT_READERS,
    stepUp: false,
    approverPermission: 'settings.approve',
  },
  /** FR-PAY-005, AC-17.1: hours a new bank-detail version is excluded from batches. */
  'payouts.bank_detail_cooling_off_hours': {
    schema: z.number().int().min(0).max(2160), readPermissions: PAYOUT_READERS, stepUp: true, approverPermission: 'settings.approve',
  },
  /** AC-PAY5-2: payees sharing one account at which the bank-detail preview warns. */
  'payouts.shared_account_threshold': {
    schema: z.number().int().min(1).max(1000), readPermissions: PAYOUT_READERS, stepUp: false, approverPermission: null,
  },
  /** AC-PAY7-2: age at which an unpaid payable is listed as dormant. */
  'payouts.dormant_after_days': {
    schema: z.number().int().min(1).max(3650), readPermissions: PAYOUT_READERS, stepUp: false, approverPermission: null,
  },
  /** D-B4-20: days before a provider's review date at which its market managers are reminded. */
  'payouts.provider_review_reminder_days': {
    schema: z.number().int().min(1).max(365), readPermissions: PAYOUT_READERS, stepUp: false, approverPermission: null,
  },
  /** FR-CAS-002 (D-B4-09): when an adjustment needs a second approver and what a related or new payee account does. */
  'adjustments.policy': {
    schema: z.strictObject({
      second_approver_above_minor: bigintString,
      new_account_days: z.number().int().min(0).max(3650),
      related_account_action: z.enum(['block', 'escalate']),
    }),
    readPermissions: [...POLICY_READERS, 'case.adjustment.create'],
    stepUp: false,
    approverPermission: 'settings.approve',
  },
  /** FR-FIN-004 (D-B4-08): write-off eligibility (at least one rule) and the second-approver threshold. */
  'write_offs.policy': {
    schema: z
      .strictObject({
        eligible_below_minor: bigintString.optional(),
        eligible_after_days: z.number().int().min(1).max(3650).optional(),
        second_approver_above_minor: bigintString,
      })
      .refine((value) => value.eligible_below_minor !== undefined || value.eligible_after_days !== undefined, 'needs an eligibility rule'),
    readPermissions: [...POLICY_READERS, 'case.write_off.create'],
    stepUp: false,
    approverPermission: 'settings.approve',
  },
  // PLAN B5 D-B5-20: none has a default (DEC-14); unset = no dispute window, no response time, no deadline, contacts hidden.
  /** FR-CAS-003 (D-B5-15): days after a run's commit a line may be disputed, and per market id the days to respond. */
  'disputes.policy': {
    schema: z.strictObject({
      window_days: z.number().int().min(1).max(3650).optional(),
      response_days: z.record(z.uuid(), z.number().int().min(1).max(365)),
    }),
    readPermissions: [...POLICY_READERS, 'case.dispute.read'],
    stepUp: false,
    approverPermission: null,
  },
  /** FR-PRV-001 (D-B5-16): per market id the days to answer a data-subject request, and how early it escalates. */
  'privacy.policy': {
    schema: z.strictObject({
      response_days: z.record(z.uuid(), z.number().int().min(1).max(365)),
      escalate_before_days: z.number().int().min(0).max(60),
    }),
    readPermissions: [...POLICY_READERS, 'privacy.manage'],
    stepUp: false,
    approverPermission: 'privacy.manage',
  },
  /** FR-DIST-005 (D-B5-11): whether a distributor sees its customers' (masked) contact details. */
  'portal.customer_contact_visible': {
    schema: z.boolean(), readPermissions: [...POLICY_READERS, 'privacy.manage'], stepUp: false, approverPermission: 'privacy.manage',
  },
  // PLAN B6 D-B6-17: none has a default (DEC-14); unset = no market requires a filing, manual full exports only.
  /** FR-PLN-007 (D-B6-02): the markets whose plan amendments need a filing record before a version is scheduled. */
  'plan.filing_requirements': {
    schema: z.strictObject({ market_ids: z.array(z.uuid()).min(1).max(50).refine(unique, 'market ids must be unique') }),
    readPermissions: ['settings.manage', 'plan.read'],
    stepUp: false,
    approverPermission: 'market.signoff',
  },
  /** FR-INT-003 (D-B6-06): the full export schedule, UTC; weekly = Mondays, monthly = the 1st. */
  'exports.full_schedule': {
    schema: z.strictObject({ cadence: z.enum(['daily', 'weekly', 'monthly']), hour_utc: z.number().int().min(0).max(23) }),
    readPermissions: ['settings.manage', 'export.full'],
    stepUp: true,
    approverPermission: null,
  },
} as const satisfies Record<string, SettingDefinition>

export type SettingKey = keyof typeof SETTINGS
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>
export type SettingValues = { readonly [K in SettingKey]?: SettingValue<K> }

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key)
}

export interface EffectiveSettings {
  readonly versionId: string
  readonly version: number
  readonly effectiveFrom: Date
  readonly values: SettingValues
}

interface VersionRow {
  id: string
  version: number
  effective_from: Date
  settings: Record<string, unknown>
}

// Stored values were validated on write; they are parsed again because the database is a trust boundary.
// Keys no longer registered are ignored.
function parseValues(settings: Record<string, unknown>): SettingValues {
  const entries = Object.entries(settings)
    .filter(([key]) => isSettingKey(key))
    .map(([key, value]) => [key, SETTINGS[key as SettingKey].schema.parse(value)])
  return Object.fromEntries(entries) as SettingValues
}

/**
 * The version in force at `at` (default now): the chain row (D-B1-01) with the greatest effective_from <= at, i.e. among
 * those the highest version. null when nothing is in force then.
 */
export async function getEffectiveSettings(tx: Tx, at?: Date): Promise<EffectiveSettings | null> {
  const { rows } = await tx.query<VersionRow>(
    `SELECT id, version, effective_from, settings FROM tenant_setting_version
     WHERE effective_from <= coalesce($1::timestamptz, now())
     ORDER BY effective_from DESC, version DESC LIMIT 1`,
    [at ?? null],
  )
  return rows[0] === undefined ? null : toEffective(rows[0])
}

function toEffective(row: VersionRow): EffectiveSettings {
  return { versionId: row.id, version: row.version, effectiveFrom: row.effective_from, values: parseValues(row.settings) }
}

/**
 * Exactly the version a record names (e.g. the settings a compliance snapshot was computed with, BR-CPL-01),
 * whatever is in force now; null when no such version exists in the tenant.
 */
export async function getSettingsVersion(tx: Tx, versionId: string): Promise<EffectiveSettings | null> {
  const { rows } = await tx.query<VersionRow>(
    'SELECT id, version, effective_from, settings FROM tenant_setting_version WHERE id = $1',
    [versionId],
  )
  return rows[0] === undefined ? null : toEffective(rows[0])
}

/** One setting in force now, or null when unset. */
export async function getSetting<K extends SettingKey>(tx: Tx, key: K): Promise<SettingValue<K> | null> {
  const settings = await getEffectiveSettings(tx)
  return (settings?.values[key] as SettingValue<K> | undefined) ?? null
}

/** Whether a caller holding `permissions` may read `key`'s values. */
export function canReadSetting(permissions: ReadonlySet<Permission>, key: string): boolean {
  return isSettingKey(key) && SETTINGS[key].readPermissions.some((permission) => permissions.has(permission))
}
