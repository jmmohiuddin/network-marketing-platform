// Read models of a plan version (API-16 GET version, diff, gates).
import { stringifyEngineJson } from '@nmp/engine'
import type { Tx } from '@nmp/db'
import { latestDecisions, outstandingDecisions } from '../cpl/index.js'
import type { PlanRow, VersionRow } from './access.js'
import { isExtension, parseCompiled, ruleRows, ruleView, stateItems, transitionRows, uncovered, validationOf, validationView, type RuleRow, type TransitionRow } from './content.js'

export function versionFields(v: VersionRow): Record<string, unknown> {
  return {
    id: v.id, plan_id: v.plan_id, version: v.version, state: v.state, revision: v.revision, effective_from: v.effective_from,
    justification: v.justification, engine_version: v.engine_version, crediting_event: v.crediting_event, placement_width: v.placement_width,
    content_hash: v.content_hash, based_on_version_id: v.based_on_version_id, submitted_by: v.submitted_by, submitted_at: v.submitted_at,
    approved_by: v.approved_by, activated_by: v.activated_by, activated_at: v.activated_at, retired_at: v.retired_at,
    created_by: v.created_by, created_at: v.created_at,
  }
}

/**
 * State items no transition covers: every item of the version this one follows (the plan's latest scheduled, active or
 * retired one), plus the one_time flags of every earlier version, which state rows carry forward (rank.ts).
 */
export async function missingTransitions(tx: Tx, plan: PlanRow, version: VersionRow, transitions: readonly TransitionRow[]): Promise<string[]> {
  const { rows } = await tx.query<{ compiled: string }>(
    `SELECT compiled::text AS compiled FROM plan_version WHERE plan_id = $1 AND id <> $2 AND state IN ('scheduled', 'active', 'retired')
     ORDER BY effective_from DESC, version DESC`,
    [plan.id, version.id],
  )
  const [latest, ...older] = rows.map((r) => parseCompiled(r.compiled))
  if (latest === undefined) return []
  const itemsOf = (c: typeof latest): string[] => stateItems(c, Object.keys(c).sort())
  const items = new Set([...itemsOf(latest), ...older.flatMap(itemsOf).filter((i) => i.startsWith('one_time.'))])
  return uncovered([...items].sort(), transitions)
}

/** Extension rules no golden dataset of the version covers (FR-PLN-003). */
export async function uncoveredExtensions(tx: Tx, versionId: string, rules: readonly RuleRow[]): Promise<string[]> {
  const { rows } = await tx.query<{ key: string }>('SELECT DISTINCT unnest(covers) AS key FROM golden_dataset WHERE plan_version_id = $1', [versionId])
  const covered = new Set(rows.map((r) => r.key))
  return rules.filter(isExtension).map((r) => r.rule_key).filter((k) => !covered.has(k))
}

export async function versionView(tx: Tx, plan: PlanRow, version: VersionRow): Promise<Record<string, unknown>> {
  const rules = await ruleRows(tx, version.id)
  const transitions = await transitionRows(tx, version.id)
  const validation = validationOf(rules, plan.calendar_ids, version.placement_width)
  const outstanding = await outstandingDecisions(tx, version.id)
  const { rows: goldens } = await tx.query<{ id: string; name: string; covers: string[]; last_result: { status: string; content_hash: string } | null }>(
    'SELECT id, name, calendar_id, covers, last_result, last_run_at FROM golden_dataset WHERE plan_version_id = $1 ORDER BY name, id', [version.id],
  )
  const { rows: simulations } = await tx.query(
    `SELECT s.id, s.state, s.finished_at, jsonb_build_object('id', p.id, 'calendar_id', p.calendar_id, 'starts_at', p.starts_at, 'ends_at', p.ends_at) AS period
     FROM simulation s JOIN period p ON p.tenant_id = s.tenant_id AND p.id = s.period_id
     WHERE s.plan_version_id = $1 AND s.kind = 'simulation' ORDER BY s.requested_at DESC, s.id`,
    [version.id],
  )
  const { rows: simulated } = await tx.query<{ ok: boolean }>('SELECT plan_version_simulated($1) AS ok', [version.id])
  const uncoveredRules = await uncoveredExtensions(tx, version.id, rules)
  const missing = await missingTransitions(tx, plan, version, transitions)
  return {
    ...versionFields(version),
    rules: rules.map((r) => ruleView(r, plan.minor_digits)),
    transitions,
    validation: validationView(validation),
    guardrails: { decisions: await latestDecisions(tx, version.id), outstanding },
    goldens,
    simulations,
    gates: {
      validation: validation.ok,
      crediting_event: version.crediting_event !== null,
      goldens: goldens.every((g) => g.last_result?.status === 'pass' && g.last_result.content_hash === version.content_hash),
      coverage: uncoveredRules.length === 0,
      guardrails: outstanding.length === 0,
      simulation: simulated[0]!.ok,
      transitions: missing.length === 0,
    },
    uncovered_extension_rules: uncoveredRules,
    missing_transitions: missing,
  }
}

const canonical = (value: unknown): string => stringifyEngineJson(value)

/** AC-PLN1-5: fields, rules and transitions of `version` against `against` (before = against, after = version). */
export async function diffView(tx: Tx, plan: PlanRow, version: VersionRow, against: VersionRow): Promise<Record<string, unknown>> {
  const view = (r: RuleRow): Record<string, unknown> => ruleView(r, plan.minor_digits)
  const fieldNames = ['crediting_event', 'placement_width', 'effective_from', 'justification', 'engine_version'] as const
  const fields = fieldNames
    .filter((name) => canonical(version[name]) !== canonical(against[name]))
    .map((name) => ({ name, before: against[name], after: version[name] }))
  const [after, before] = [await ruleRows(tx, version.id), await ruleRows(tx, against.id)]
  const content = (r: RuleRow): string => canonical({ kind: r.kind, params: r.params, reversal_policy: r.reversal_policy, calendar_id: r.calendar_id, ordinal: r.ordinal })
  const [tAfter, tBefore] = [await transitionRows(tx, version.id), await transitionRows(tx, against.id)]
  return {
    fields,
    rules: {
      added: after.filter((r) => !before.some((b) => b.rule_key === r.rule_key)).map(view),
      removed: before.filter((r) => !after.some((a) => a.rule_key === r.rule_key)).map(view),
      changed: after.flatMap((r) => {
        const b = before.find((x) => x.rule_key === r.rule_key)
        if (b === undefined || content(b) === content(r)) return []
        const [viewBefore, viewAfter] = [view(b), view(r)]
        return [{ rule_key: r.rule_key, before: viewBefore, after: viewAfter, rendering_before: viewBefore.rendering, rendering_after: viewAfter.rendering }]
      }),
    },
    transitions: {
      added: tAfter.filter((t) => !tBefore.some((b) => b.state_item === t.state_item)),
      removed: tBefore.filter((t) => !tAfter.some((a) => a.state_item === t.state_item)),
      changed: tAfter.flatMap((t) => {
        const b = tBefore.find((x) => x.state_item === t.state_item)
        return b === undefined || canonical(b) === canonical(t) ? [] : [{ state_item: t.state_item, before: b, after: t }]
      }),
    },
  }
}
