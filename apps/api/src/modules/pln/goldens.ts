// Golden datasets per version and calendar (PLAN B3 D-B3-16, FR-PLN-006): inline engine input and expected lines,
// run line by line against the version's current compiled plan; last_result kept. Frozen from a completed simulation
// through comp_simulation_source (never COMP TypeScript).
import { gunzipSync } from 'node:zlib'
import { EngineError, parseEngineJson, run, type RunSettings, type Snapshot } from '@nmp/engine'
import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requirePermission, requireRealm, type AuthContext } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { getSettingsVersion } from '../ten/index.js'
import { assertDraft, loadPlan, loadVersion, planVersionFor, sqlState, versionParams } from './access.js'
import { isExtension, parseCompiled, ruleRows } from './content.js'

const MAX_JSON_BYTES = 5 * 1024 * 1024
/** Room for a 5 MB input plus expected lines, so an oversized golden is answered 422 GOLDEN_TOO_LARGE, not 413. */
const GOLDEN_BODY_LIMIT = 12 * 1024 * 1024
const MONEY = /^-?(0|[1-9]\d{0,17})$/
const KEY = /^[a-z][a-z0-9_]{0,63}$/

const expectedLine = z.strictObject({
  payee_position_id: z.string().min(1).max(100),
  rule_key: z.string().min(1).max(64),
  origin_type: z.enum(['late_transaction', 'clawback', 'manual', 'restatement']).nullable().optional(),
  origin_id: z.string().min(1).max(100).nullable().optional(),
  amount_minor: z.string().regex(MONEY),
})
const expectedSchema = z.strictObject({ lines: z.array(expectedLine), total_minor: z.string().regex(MONEY) })
type Expected = z.infer<typeof expectedSchema>
const inputSchema = z.strictObject({ snapshot: z.record(z.string(), z.unknown()), settings: z.record(z.string(), z.unknown()) })
const name = z.string().trim().min(1).max(100)
const covers = z.array(z.string().regex(KEY)).max(100)
const createBody = z.union([
  z.strictObject({ name, calendar_id: z.uuid(), covers, input: z.unknown(), expected: z.unknown() }),
  z.strictObject({ name, covers, from_simulation_id: z.uuid() }),
])
const goldenParams = versionParams.extend({ goldenId: z.uuid() })

const invalid = (message: string, details: unknown = null): ApiError => new ApiError(422, 'GOLDEN_INVALID', message, details)

/** Expected lines: money strings only (a JSON number is refused), total = sum of lines (AC-GLD-1). */
function checkExpected(value: unknown): Expected {
  const parsed = expectedSchema.safeParse(value)
  if (!parsed.success) throw invalid('Expected lines need amount_minor and total_minor as whole minor units in strings.', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
  const keys = parsed.data.lines.map(keyOf)
  const repeated = parsed.data.lines.filter((_, i) => keys.indexOf(keys[i]!) !== i)
  if (repeated.length > 0) throw invalid('Each expected line is one payee, rule and origin; list it once.', { lines: repeated })
  const sum = parsed.data.lines.reduce((acc, l) => acc + BigInt(l.amount_minor), 0n)
  if (sum !== BigInt(parsed.data.total_minor)) throw invalid('total_minor must equal the sum of the expected lines.', { sum_minor: sum.toString() })
  return parsed.data
}

/** Measured as the CHECK on golden_dataset measures it (jsonb text, which is longer than compact JSON). */
async function checkSize(tx: Tx, input: unknown, expected: unknown): Promise<void> {
  const { rows } = await tx.query<{ too_large: boolean }>(
    'SELECT octet_length($1::jsonb::text) > $3 OR octet_length($2::jsonb::text) > $3 AS too_large', [JSON.stringify(input), JSON.stringify(expected), MAX_JSON_BYTES],
  )
  if (rows[0]!.too_large) throw new ApiError(422, 'GOLDEN_TOO_LARGE', 'A golden dataset input and its expected lines are at most 5 MB each.')
}

export interface GoldenResult { readonly id: string; readonly name: string; readonly status: 'pass' | 'fail'; readonly mismatches: readonly Mismatch[]; readonly error: { code: string; message: string } | null }
interface Mismatch { readonly payee_position_id: string; readonly rule_key: string; readonly origin_type: string | null; readonly origin_id: string | null; readonly expected_minor: string; readonly actual_minor: string }
interface LineKey { readonly payee_position_id: string; readonly rule_key: string; readonly origin_type?: string | null | undefined; readonly origin_id?: string | null | undefined }

const keyOf = (l: LineKey): string => JSON.stringify([l.payee_position_id, l.rule_key, l.origin_type ?? null, l.origin_id ?? null])

function compare(expected: Expected, actual: readonly (LineKey & { amount_minor: string })[]): Mismatch[] {
  const want = new Map(expected.lines.map((l) => [keyOf(l), l]))
  const got = new Map(actual.map((l) => [keyOf(l), l]))
  return [...new Set([...want.keys(), ...got.keys()])].sort().flatMap((k) => {
    const line = (want.get(k) ?? got.get(k))!
    const e = want.get(k)?.amount_minor ?? '0'
    const a = got.get(k)?.amount_minor ?? '0'
    return BigInt(e) === BigInt(a) ? [] : [{ payee_position_id: line.payee_position_id, rule_key: line.rule_key, origin_type: line.origin_type ?? null, origin_id: line.origin_id ?? null, expected_minor: e, actual_minor: a }]
  })
}

/**
 * Runs every golden dataset of the version against its current compiled plan (contentHash = hex digest of compiled,
 * effectiveFromUs = effective_from or the golden period's start, D-B3-02) and stores last_result. 422 PLAN_INVALID when
 * the version does not compile.
 */
export async function runGoldens(tx: Tx, versionId: string): Promise<GoldenResult[]> {
  const { rows: versions } = await tx.query<{ compiled: string | null; hash: string | null; effective_us: string | null }>(
    `SELECT compiled::text AS compiled, encode(digest(compiled::text, 'sha256'), 'hex') AS hash,
            (extract(epoch FROM effective_from) * 1000000)::bigint::text AS effective_us
     FROM plan_version WHERE id = $1`,
    [versionId],
  )
  const version = versions[0]!
  if (version.compiled === null || version.hash === null) throw new ApiError(422, 'PLAN_INVALID', 'The version has validation errors, so it cannot run.')
  const compiled = parseCompiled(version.compiled)
  const { rows: goldens } = await tx.query<{ id: string; name: string; calendar_id: string; input: unknown; expected: Expected }>(
    'SELECT id, name, calendar_id, input, expected FROM golden_dataset WHERE plan_version_id = $1 ORDER BY name, id', [versionId],
  )
  const results: GoldenResult[] = []
  for (const g of goldens) {
    const result = runOne(g, compiled[g.calendar_id], version.hash, version.effective_us)
    results.push(result)
    await tx.query('UPDATE golden_dataset SET last_result = $2, last_run_at = now() WHERE id = $1', [
      g.id, { status: result.status, mismatches: result.mismatches, error: result.error, content_hash: version.hash },
    ])
  }
  await recordAudit(tx, { action: 'GOLDEN_DATASET.RUN', objectType: 'plan_version', objectId: versionId, after: { datasets: results.map((r) => ({ id: r.id, status: r.status })) } })
  return results
}

function runOne(g: { id: string; name: string; input: unknown; expected: Expected }, plan: ReturnType<typeof parseCompiled>[string] | undefined, hash: string, effectiveUs: string | null): GoldenResult {
  const fail = (code: string, message: string): GoldenResult => ({ id: g.id, name: g.name, status: 'fail', mismatches: [], error: { code, message } })
  if (plan === undefined) return fail('CALENDAR_NOT_IN_PLAN', 'The golden dataset names a calendar the version does not compile for.')
  try {
    const input = parseCompiledInput(g.input)
    const output = run({ plan: { ...plan, contentHash: hash, effectiveFromUs: effectiveUs === null ? input.snapshot.period.startsAtUs : BigInt(effectiveUs) }, settings: input.settings, snapshot: input.snapshot })
    const actual = output.lines.map((l) => ({ payee_position_id: l.payeePositionId, rule_key: l.ruleKey, origin_type: l.origin?.originType ?? null, origin_id: l.origin?.originId ?? null, amount_minor: l.amountMinor.toString() }))
    const mismatches = compare(g.expected, actual)
    return { id: g.id, name: g.name, status: mismatches.length === 0 ? 'pass' : 'fail', mismatches, error: null }
  } catch (error) {
    // A tenant-supplied input the engine cannot read is a failing golden, not a server error.
    if (error instanceof EngineError) return fail(error.code, error.message)
    if (isUnreadable(error)) return fail('INVALID_INPUT', 'The golden input is not a complete engine snapshot.')
    throw error
  }
}

/** A missing field (TypeError) or a *Minor / *Us value that is not a whole number (SyntaxError, RangeError). */
const isUnreadable = (error: unknown): boolean => error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError

const parseCompiledInput = (input: unknown): { snapshot: Snapshot; settings: RunSettings } =>
  parseEngineJson<{ snapshot: Snapshot; settings: RunSettings }>(JSON.stringify(input))

/** FR-PLN-006 freeze: input = the simulation's stored snapshot with its run settings, expected = its lines (AC-GLD-2). */
async function fromSimulation(tx: Tx, versionId: string, simulationId: string): Promise<{ calendarId: string; input: unknown; expected: Expected }> {
  const { rows } = await tx.query<{ calendar_id: string; settings_version_id: string | null; content: Buffer; lines: Expected['lines'] }>(
    `SELECT src.calendar_id, src.settings_version_id, src.content, src.lines FROM simulation s, comp_simulation_source(s.id) src
     WHERE s.id = $1 AND s.plan_version_id = $2 AND s.kind = 'simulation'`,
    [simulationId, versionId],
  )
  const source = rows[0]
  if (source === undefined) throw new ApiError(422, 'SIMULATION_NOT_COMPLETED', 'Only a completed simulation of this version can be frozen as a golden dataset.')
  const settings = source.settings_version_id === null ? null : await getSettingsVersion(tx, source.settings_version_id)
  const values = settings?.values ?? {}
  const runSettings = {
    settingsVersionId: source.settings_version_id,
    roundingMode: values['money.rounding_mode'] ?? 'half_up', // BR-MNY-02 platform default, as the simulation ran
    restockingFeeAffectsVolume: values['orders.restocking_fee_volume_effect'] === 'proportional',
  }
  const lines = source.lines.map((l) => ({ ...l, origin_type: l.origin_type ?? null, origin_id: l.origin_id ?? null }))
  const total = lines.reduce((acc, l) => acc + BigInt(l.amount_minor), 0n)
  return { calendarId: source.calendar_id, input: { snapshot: JSON.parse(gunzipSync(source.content).toString('utf8')), settings: runSettings }, expected: { lines, total_minor: total.toString() } }
}

const LIST_COLUMNS = 'id, name, calendar_id, covers, source_simulation_id, last_result, last_run_at, created_by, created_at'

/**
 * A golden input is an engine snapshot: positions, relationships and owners of the whole tenant and orders with buyers
 * (a frozen simulation copies them all). Only a reader of genealogy and orders over every market sees it; others get null.
 */
const seesInput = (auth: AuthContext): boolean => marketScope(auth, 'genealogy.read') === null && marketScope(auth, 'order.read') === null

export function registerGoldenRoutes(app: FastifyInstance): void {
  const base = '/v1/plans/:id/versions/:v/golden-datasets'

  app.get(base, { preHandler: [requireRealm('tenant'), requirePermission('plan.read')] }, async (request) => {
    const params = parse(versionParams, request.params)
    return inTenant(request, async (tx) => {
      const plan = await loadPlan(tx, request, params.id, 'plan.read')
      const version = await loadVersion(tx, plan.id, params.v)
      const { rows } = await tx.query(`SELECT ${LIST_COLUMNS} FROM golden_dataset WHERE plan_version_id = $1 ORDER BY name, id`, [version.id])
      return envelope(rows)
    })
  })

  app.get(`${base}/:goldenId`, { preHandler: [requireRealm('tenant'), requirePermission('plan.read')] }, async (request) => {
    const params = parse(goldenParams, request.params)
    return inTenant(request, async (tx) => {
      const plan = await loadPlan(tx, request, params.id, 'plan.read')
      const version = await loadVersion(tx, plan.id, params.v)
      const { rows } = await tx.query(
        `SELECT ${LIST_COLUMNS}, CASE WHEN $3 THEN input END AS input, expected FROM golden_dataset WHERE id = $1 AND plan_version_id = $2`,
        [params.goldenId, version.id, seesInput(currentAuth(request))],
      )
      if (rows[0] === undefined) throw notFound()
      return envelope(rows[0])
    })
  })

  app.post(base, { bodyLimit: GOLDEN_BODY_LIMIT, preHandler: [requireRealm('tenant'), requirePermission('plan.edit')] }, async (request, reply) => {
    const body = parse(createBody, request.body)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const { version } = await planVersionFor(tx, request, 'plan.edit')
      assertDraft(version)
      const extensions = (await ruleRows(tx, version.id)).filter(isExtension).map((r) => r.rule_key)
      const unknown = body.covers.filter((k) => !extensions.includes(k))
      if (unknown.length > 0) throw new ApiError(422, 'UNKNOWN_EXTENSION_RULE', 'covers names rules that are not extension rules of this version.', { rule_keys: unknown })
      const source = 'from_simulation_id' in body
        ? { ...(await fromSimulation(tx, version.id, body.from_simulation_id)), simulationId: body.from_simulation_id }
        : { calendarId: body.calendar_id, input: body.input, expected: body.expected, simulationId: null }
      await checkSize(tx, source.input, source.expected)
      if (!inputSchema.safeParse(source.input).success) throw invalid('input is {snapshot, settings}: an engine snapshot and its run settings.')
      try {
        parseCompiledInput(source.input)
      } catch (error) {
        if (!isUnreadable(error)) throw error
        throw invalid('Every *Minor and *Us value of the input is a whole number in a string.')
      }
      const expected = checkExpected(source.expected)
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO golden_dataset (tenant_id, plan_version_id, calendar_id, name, input, expected, covers, source_simulation_id, created_by)
         VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7, app_user_id()) RETURNING id`,
        [version.id, source.calendarId, body.name, JSON.stringify(source.input), expected, [...new Set(body.covers)].sort(), source.simulationId],
      ).catch((error: unknown) => {
        if (sqlState(error) === '23505') throw new ApiError(409, 'GOLDEN_NAME_TAKEN', 'This version already has a golden dataset with that name.')
        if (sqlState(error) === '23514' || sqlState(error) === '23503') throw new ApiError(422, 'CALENDAR_NOT_IN_PLAN', 'The calendar is not a calendar of the plan.')
        throw error
      })
      const id = rows[0]!.id
      await recordAudit(tx, { action: 'GOLDEN_DATASET.CREATED', objectType: 'golden_dataset', objectId: id, after: { plan_version_id: version.id, calendar_id: source.calendarId, covers: body.covers, source_simulation_id: source.simulationId } })
      const { rows: created } = await tx.query(`SELECT ${LIST_COLUMNS} FROM golden_dataset WHERE id = $1`, [id])
      return { statusCode: 201, body: envelope(created[0]) }
    }))
    return sendIdempotent(reply, result)
  })

  app.delete(`${base}/:goldenId`, { preHandler: [requireRealm('tenant'), requirePermission('plan.edit')] }, async (request, reply) => {
    const params = parse(goldenParams, request.params)
    await inTenant(request, async (tx) => {
      const { version } = await planVersionFor(tx, request, 'plan.edit')
      assertDraft(version)
      const { rowCount } = await tx.query('DELETE FROM golden_dataset WHERE id = $1 AND plan_version_id = $2', [params.goldenId, version.id])
      if (rowCount !== 1) throw notFound()
      await recordAudit(tx, { action: 'GOLDEN_DATASET.DELETED', objectType: 'golden_dataset', objectId: params.goldenId, before: { plan_version_id: version.id } })
    })
    return reply.code(204).send()
  })

  app.post(`${base}/run`, { preHandler: [requireRealm('tenant'), requirePermission('plan.simulate')] }, async (request, reply) => {
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const { version } = await planVersionFor(tx, request, 'plan.simulate', false)
      const results = await runGoldens(tx, version.id)
      return { statusCode: 200, body: envelope(results) }
    }))
    return sendIdempotent(reply, result)
  })
}
