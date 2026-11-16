import type { Tx } from '@nmp/db'
import { z } from 'zod'
import type { Permission } from '../../lib/permissions.js'

const INT64_MAX = 9_223_372_036_854_775_807n

/** A non-negative bigint in minor units, as a decimal string (no floats in money or volume paths). */
const bigintString = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/, 'must be a non-negative whole number as a string')
  .refine((value) => BigInt(value) <= INT64_MAX, 'must fit in 64 bits')

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
  /** BR-MNY-02: a change needs a Finance approver (setting change request, FR-TEN-003); never written directly. */
  readonly moneyAffecting: boolean
}

const COMPLIANCE_READERS: readonly Permission[] = ['settings.manage', 'compliance.read']
const POLICY_READERS: readonly Permission[] = ['settings.manage', 'settings.approve']

/**
 * Every tenant setting key. None has a default (DEC-14, E-ADR-11): an unset threshold is null and the
 * report that needs it omits the indicator and says so.
 */
export const SETTINGS = {
  /** R4: personal volume (minor units) that makes an earner active. */
  'compliance.active_pv_minor': { schema: bigintString, readPermissions: COMPLIANCE_READERS, stepUp: false, moneyAffecting: false },
  /** R4: rank name -> personal volume threshold (minor units). */
  'compliance.rank_thresholds_pv_minor': {
    schema: z.record(z.string().trim().min(1).max(64), bigintString).refine((value) => Object.keys(value).length > 0, 'needs at least one rank'),
    readPermissions: COMPLIANCE_READERS,
    stepUp: false,
    moneyAffecting: false,
  },
  /** R4: day of month from which an order counts as late (end-of-period threshold orders). */
  'compliance.late_order_day': {
    schema: z.number().int().min(1).max(31), readPermissions: COMPLIANCE_READERS, stepUp: false, moneyAffecting: false,
  },
  /** R2: personal-use share that flags an earner, as an exact fraction (numerator <= denominator). */
  'compliance.personal_share_flag': {
    schema: z
      .strictObject({ numerator: bigintString, denominator: positiveBigintString })
      .refine((ratio) => BigInt(ratio.numerator) <= BigInt(ratio.denominator), 'numerator must not exceed denominator'),
    readPermissions: COMPLIANCE_READERS,
    stepUp: false,
    moneyAffecting: false,
  },
  /** FR-PRV-004: breach-notification contacts (at least one). */
  'privacy.breach_contacts': {
    schema: z.array(breachContact).min(1).max(20),
    readPermissions: ['settings.manage'],
    stepUp: true,
    moneyAffecting: false,
  },
  /** BR-MNY-02: rounding of money amounts. Unset = the platform rule half-up applies (engine, B3). */
  'money.rounding_mode': {
    schema: z.enum(['half_up', 'half_even']), readPermissions: POLICY_READERS, stepUp: false, moneyAffecting: true,
  },
  /** How a refund claws back commission already paid (B4 may add per-bonus-type overrides). */
  'money.clawback_policy': {
    schema: z.strictObject({ default: z.enum(['order_line', 'restatement']) }),
    readPermissions: POLICY_READERS,
    stepUp: false,
    moneyAffecting: true,
  },
  /** BR-PLN-04: days of notice before a plan version activates. */
  'plan.activation_notice_days': {
    schema: z.number().int().min(0).max(365), readPermissions: POLICY_READERS, stepUp: false, moneyAffecting: false,
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
