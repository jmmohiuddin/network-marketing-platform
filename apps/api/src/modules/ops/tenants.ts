import type { Tx } from '@nmp/db'
import { notFound } from '../../lib/errors.js'

/** Background jobs of one tenant by state (pg-boss job table): the console's job health (AC-57.1). */
export interface JobHealth {
  queued: number
  running: number
  failed: number
}

/** Operational metadata only (AC-57.1): no participant, order or payout data. */
export interface TenantView {
  id: string
  slug: string
  legal_name: string
  region: string
  isolation_tier: string
  state: string
  dpa_document_id: string | null
  created_at: Date
  job_health: JobHealth
}

export interface MarketView {
  id: string
  code: string
  currency: string
  minor_unit: number
  time_zone: string
  languages: string[]
  market_pack: string
  state: string
}

export interface TenantDetail extends TenantView {
  markets: MarketView[]
}

type TenantRow = Omit<TenantView, 'job_health'>

const TENANT_SELECT = 'SELECT id, slug, legal_name, region, isolation_tier, state, dpa_document_id, created_at FROM tenant'
const NO_JOBS: JobHealth = { queued: 0, running: 0, failed: 0 }

// Jobs carry { tenantId, payload } (lib/jobs.ts); only counts leave this function, never job data.
async function jobHealth(tx: Tx, tenantIds: readonly string[]): Promise<ReadonlyMap<string, JobHealth>> {
  const { rows } = await tx.query<JobHealth & { tenant_id: string }>(
    `SELECT data->>'tenantId' AS tenant_id,
            count(*) FILTER (WHERE state IN ('created', 'retry'))::int AS queued,
            count(*) FILTER (WHERE state = 'active')::int AS running,
            count(*) FILTER (WHERE state = 'failed')::int AS failed
     FROM pgboss.job WHERE data->>'tenantId' = ANY ($1::text[]) GROUP BY 1`,
    [tenantIds],
  )
  return new Map(rows.map(({ tenant_id, ...health }) => [tenant_id, health]))
}

async function withHealth(tx: Tx, tenants: readonly TenantRow[]): Promise<TenantView[]> {
  const health = await jobHealth(tx, tenants.map((tenant) => tenant.id))
  return tenants.map((tenant) => ({ ...tenant, job_health: health.get(tenant.id) ?? NO_JOBS }))
}

/** The vendor console's tenant list (SC-39), ordered by slug. Runs in the vendor realm. */
export async function listTenants(tx: Tx, state: string | undefined, afterSlug: string | undefined, limit: number): Promise<TenantView[]> {
  const { rows } = await tx.query<TenantRow>(
    `${TENANT_SELECT} WHERE ($1::text IS NULL OR state = $1) AND ($2::text IS NULL OR slug > $2) ORDER BY slug LIMIT $3`,
    [state ?? null, afterSlug ?? null, limit + 1],
  )
  return withHealth(tx, rows)
}

/** One tenant with its markets (tenant metadata the vendor realm reads: policy vendor_read on market). */
export async function getTenant(tx: Tx, id: string): Promise<TenantDetail> {
  const { rows } = await tx.query<TenantRow>(`${TENANT_SELECT} WHERE id = $1`, [id])
  const [tenant] = await withHealth(tx, rows)
  if (tenant === undefined) throw notFound()
  const markets = await tx.query<MarketView>(
    `SELECT id, code, currency, minor_unit, time_zone, languages, market_pack, state FROM market
     WHERE tenant_id = $1 ORDER BY code`,
    [id],
  )
  return { ...tenant, markets: markets.rows }
}
