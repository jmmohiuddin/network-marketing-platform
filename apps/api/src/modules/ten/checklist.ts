import type { Tx } from '@nmp/db'
import { recordedProviders, type ProviderKind, type RecordedProvider } from '../pay/index.js'
import type { MarketView } from './markets.js'
import { getSetting } from './settings.js'

export type ItemKind = 'evidence' | 'attestation' | 'provider' | 'automatic'
export type ItemCategory = 'regulatory' | 'payment' | 'tax' | 'plan' | 'data'
export type ItemStatus = 'complete' | 'missing' | 'needs_risk_acceptance'

interface ItemDefinition {
  readonly item: string
  readonly title: string
  readonly kind: ItemKind
  readonly category: ItemCategory
  readonly providerKind?: ProviderKind
}

/**
 * FR-TEN-004 launch checklist (D-B1-15): one platform list, every item mandatory in B1. Evidence items need a document,
 * attestations a note, provider items a recorded approval (PAY), automatic items are computed.
 */
export const CHECKLIST_ITEMS = [
  { item: 'licence_evidence', title: 'Licence or registration evidence', kind: 'evidence', category: 'regulatory' },
  { item: 'payout_provider', title: 'Payout provider eligibility', kind: 'provider', category: 'payment', providerKind: 'payout' },
  { item: 'payment_provider', title: 'Payment provider eligibility', kind: 'provider', category: 'payment', providerKind: 'payment' },
  { item: 'tax_configuration', title: 'Tax configuration reference', kind: 'evidence', category: 'tax' },
  // D-B2-15: complete when the market has a published agreement version (PAR).
  { item: 'agreement_versions', title: 'Participant agreement versions', kind: 'automatic', category: 'regulatory' },
  { item: 'data_region', title: 'Data region', kind: 'attestation', category: 'data' },
  // D-B3 (PLAN B3 section R): complete when a scheduled or active version of a plan covers the market (PLN).
  { item: 'plan_variant', title: 'Plan variant', kind: 'automatic', category: 'plan' },
  { item: 'breach_contacts', title: 'Breach notification contacts', kind: 'automatic', category: 'data' },
  { item: 'pack_rules', title: 'Market-pack rules basis', kind: 'automatic', category: 'regulatory' },
] as const satisfies readonly ItemDefinition[]

export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number]['item']

export function checklistItem(item: string): ItemDefinition | undefined {
  return CHECKLIST_ITEMS.find((definition) => definition.item === item)
}

const MISSING_REASONS: Readonly<Record<Exclude<ItemKind, 'automatic'>, string>> = {
  evidence: 'No evidence document is recorded.',
  attestation: 'No attestation note is recorded.',
  provider: 'No recorded provider approval for this market.',
}
// The automatic items that can be missing (pack rules need a risk acceptance at sign-off instead).
const AUTOMATIC_MISSING: Readonly<Record<string, string>> = {
  breach_contacts: 'No breach notification contact is in force.',
  agreement_versions: 'No participant agreement version is published for this market.',
  plan_variant: 'No scheduled or active plan version covers this market.',
}

export interface PackRule {
  kind: string
  id: string
  title: string
  mandatory: boolean
  basis: string
  basis_status: 'screening' | 'primary_read' | 'counsel_confirmed'
  source_ref: string
  reviewed_by: string | null
  reviewed_at: string | null
  effective_from: string
  effective_to: string | null
}

interface EntryRow {
  id: string
  item: string
  document_id: string | null
  note: string | null
  recorded_by: string
  recorded_by_name: string | null
  recorded_at: Date
  file_name: string | null
  mime: string | null
  size_bytes: string | null
  sha256: string | null
}

export interface EntryView {
  id: string
  document: { id: string; file_name: string | null; mime: string; size_bytes: number; sha256: string } | null
  note: string | null
  recorded_by: { id: string; display_name: string | null }
  recorded_at: Date
}

export interface ItemView {
  item: string
  title: string
  kind: ItemKind
  category: ItemCategory
  mandatory: true
  status: ItemStatus
  entry: EntryView | null
  detail: unknown
}

export interface Evaluation {
  readonly items: ItemView[]
  /** Users whose work the checklist counts (SoD contributors, FR-IAM-004). */
  readonly contributors: string[]
  /** Mandatory pack rules still at basis status screening (FR-CPL-012). */
  readonly screeningRules: PackRule[]
  /** What a go-live request snapshots: each item's status and the entry / provider records it counted. */
  readonly snapshot: { items: { item: string; status: ItemStatus; entry_id: string | null; document_id: string | null; provider_ids: string[] }[] }
}

/** The latest entry of each recorded item: the entries the checklist counts. */
async function currentEntries(tx: Tx, marketId: string): Promise<Map<string, EntryView>> {
  const { rows } = await tx.query<EntryRow>(
    `SELECT DISTINCT ON (e.item) e.id, e.item, e.document_id, e.note, e.recorded_by, u.display_name AS recorded_by_name,
            e.recorded_at, d.file_name, d.mime, d.size_bytes::text AS size_bytes, d.sha256
     FROM market_checklist_entry e
     JOIN user_account u ON u.id = e.recorded_by
     LEFT JOIN LATERAL document_summary(e.document_id) d ON true
     WHERE e.market_id = $1
     ORDER BY e.item, e.recorded_at DESC, e.id DESC`,
    [marketId],
  )
  return new Map(rows.map((row) => [row.item, {
    id: row.id,
    document: row.document_id === null ? null : {
      id: row.document_id, file_name: row.file_name, mime: row.mime!, size_bytes: Number(row.size_bytes), sha256: row.sha256!,
    },
    note: row.note,
    recorded_by: { id: row.recorded_by, display_name: row.recorded_by_name },
    recorded_at: row.recorded_at,
  }]))
}

/** FR-CPL-012: the market pack's rules in force today (CPL data, read through SQL market_pack_rules). */
export async function packRules(tx: Tx, pack: string): Promise<PackRule[]> {
  const { rows } = await tx.query<PackRule>(
    `SELECT kind, id, title, mandatory, basis, basis_status, source_ref, reviewed_by,
            to_char(reviewed_at, 'YYYY-MM-DD') AS reviewed_at, to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(effective_to, 'YYYY-MM-DD') AS effective_to
     FROM market_pack_rules($1, current_date)`,
    [pack],
  )
  return rows
}

interface AgreementVersionRef {
  readonly id: string
  readonly label: string
  readonly published_at: Date
}

/** The market's current agreement version: the latest published (D-B2-15). */
async function currentAgreement(tx: Tx, marketId: string): Promise<AgreementVersionRef | null> {
  const { rows } = await tx.query<AgreementVersionRef>(
    `SELECT id, label, published_at FROM agreement_version WHERE market_id = $1 ORDER BY published_at DESC, id DESC LIMIT 1`,
    [marketId],
  )
  return rows[0] ?? null
}

interface PlanVariantRef {
  readonly plan_id: string
  readonly plan_name: string
  readonly version_id: string
  readonly version: number
  readonly state: 'scheduled' | 'active'
}

/** The plan version that runs (or will run) the market: an active one first, else the latest scheduled. */
async function planVariant(tx: Tx, marketId: string): Promise<PlanVariantRef | null> {
  const { rows } = await tx.query<PlanVariantRef>(
    `SELECT p.id AS plan_id, p.name AS plan_name, v.id AS version_id, v.version, v.state
     FROM plan_market m
     JOIN plan p ON p.tenant_id = m.tenant_id AND p.id = m.plan_id
     JOIN plan_version v ON v.tenant_id = m.tenant_id AND v.plan_id = m.plan_id
     WHERE m.market_id = $1 AND v.state IN ('scheduled', 'active')
     ORDER BY v.state = 'active' DESC, v.effective_from DESC, v.id
     LIMIT 1`,
    [marketId],
  )
  return rows[0] ?? null
}

interface Facts {
  readonly entries: Map<string, EntryView>
  readonly agreement: AgreementVersionRef | null
  readonly plan: PlanVariantRef | null
  readonly providers: RecordedProvider[]
  readonly region: string
  readonly contacts: number
  readonly rules: PackRule[]
}

function statusOf(definition: ItemDefinition, facts: Facts, providers: RecordedProvider[]): ItemStatus {
  const entry = facts.entries.get(definition.item)
  switch (definition.kind) {
    case 'evidence': return entry?.document != null ? 'complete' : 'missing'
    case 'attestation': return entry?.note != null ? 'complete' : 'missing'
    case 'provider': return providers.length > 0 ? 'complete' : 'missing'
    case 'automatic':
      if (definition.item === 'breach_contacts') return facts.contacts > 0 ? 'complete' : 'missing'
      if (definition.item === 'agreement_versions') return facts.agreement !== null ? 'complete' : 'missing'
      if (definition.item === 'plan_variant') return facts.plan !== null ? 'complete' : 'missing'
      return facts.rules.some((rule) => rule.mandatory && rule.basis_status === 'screening') ? 'needs_risk_acceptance' : 'complete'
  }
}

function detailOf(definition: ItemDefinition, facts: Facts, providers: RecordedProvider[]): unknown {
  if (definition.kind === 'provider') {
    return { providers: providers.map((p) => ({ id: p.id, provider: p.provider, approved_at: p.approvedAt, funds_holder: p.fundsHolder })) }
  }
  switch (definition.item) {
    case 'data_region': return { region: facts.region }
    case 'breach_contacts': return { contacts: facts.contacts }
    case 'agreement_versions': return { version: facts.agreement }
    case 'plan_variant': return { version: facts.plan }
    case 'pack_rules': return { rules: facts.rules }
    case 'tax_configuration': return { rules: facts.rules.filter((rule) => rule.kind === 'tax') }
    default: return null
  }
}

/** Evaluates every item of the market's checklist now (T-B1-09). */
export async function evaluateChecklist(tx: Tx, market: MarketView): Promise<Evaluation> {
  const { rows } = await tx.query<{ region: string }>('SELECT region FROM tenant WHERE id = app_tenant_id()')
  const facts: Facts = {
    entries: await currentEntries(tx, market.id),
    agreement: await currentAgreement(tx, market.id),
    plan: await planVariant(tx, market.id),
    providers: await recordedProviders(tx, market.id),
    region: rows[0]!.region,
    contacts: (await getSetting(tx, 'privacy.breach_contacts'))?.length ?? 0,
    rules: await packRules(tx, market.market_pack),
  }
  const items: ItemView[] = []
  const snapshot: Evaluation['snapshot']['items'] = []
  const contributors = new Set<string>()
  for (const definition of CHECKLIST_ITEMS as readonly ItemDefinition[]) {
    const providers = facts.providers.filter((provider) => provider.kind === definition.providerKind)
    // B1/B2 entries of an item that is automatic now (agreement_versions, plan_variant) are history: not counted.
    const entry = definition.kind === 'automatic' ? null : facts.entries.get(definition.item) ?? null
    const status = statusOf(definition, facts, providers)
    if (entry !== null) contributors.add(entry.recorded_by.id)
    for (const provider of providers) contributors.add(provider.createdBy)
    items.push({ item: definition.item, title: definition.title, kind: definition.kind, category: definition.category, mandatory: true, status, entry, detail: detailOf(definition, facts, providers) })
    snapshot.push({ item: definition.item, status, entry_id: entry?.id ?? null, document_id: entry?.document?.id ?? null, provider_ids: providers.map((p) => p.id) })
  }
  return {
    items, contributors: [...contributors], snapshot: { items: snapshot },
    screeningRules: facts.rules.filter((rule) => rule.mandatory && rule.basis_status === 'screening'),
  }
}

/** The items that block a go-live request or sign-off, named (AC-38.1, AC-53.1). */
export function missingItems(evaluation: Evaluation): { item: string; title: string; reason: string }[] {
  return evaluation.items
    .filter((item) => item.status === 'missing')
    .map((item) => ({
      item: item.item, title: item.title,
      reason: item.kind === 'automatic' ? AUTOMATIC_MISSING[item.item]! : MISSING_REASONS[item.kind],
    }))
}

export function summaryOf(evaluation: Evaluation): Record<ItemStatus, number> {
  const count = (status: ItemStatus) => evaluation.items.filter((item) => item.status === status).length
  return { complete: count('complete'), missing: count('missing'), needs_risk_acceptance: count('needs_risk_acceptance') }
}
