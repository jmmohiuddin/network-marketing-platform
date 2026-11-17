import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { getSetting } from './settings.js'

// The plan parameters B2 modules read (D-B3-06, D-B3-07), through the PLAN 4.2 SQL contracts: PAR, GEN and ORD never
// import PLN code. PLN validates these params when a rule is written; parsing here guards the reader.

/**
 * D-B3-06: the placement width of the market's plan version in force now (null when it sets none); the retired setting
 * only when no version covers the market, as the crediting event (D-B3-05). A submitted version always has a crediting
 * event, so plan_crediting_event (same version selection as placement_width_for) tells whether one covers the market.
 */
export async function placementWidthFor(tx: Tx, marketId: string): Promise<number | null> {
  const { rows } = await tx.query<{ width: number | null; covered: boolean }>(
    'SELECT placement_width_for($1) AS width, plan_crediting_event($1, now()) IS NOT NULL AS covered', [marketId])
  if (rows[0]!.covered) return rows[0]!.width
  // shortcut: legacy fallback until every tenant has a plan version, drop in B6
  return getSetting(tx, 'genealogy.placement_width')
}

const tree = z.enum(['sponsor', 'placement'])
const STRUCTURAL_RULES = {
  'genealogy.reparent_on_termination': z.object({ tree }),
  'genealogy.change_window': z.object({ tree, withinDaysOfEnrolment: z.number().int().min(1) }),
  'genealogy.positions_limit': z.object({ max: z.number().int().min(1) }),
}
export type StructuralRuleKind = keyof typeof STRUCTURAL_RULES

export interface StructuralRule<K extends StructuralRuleKind> {
  /** '<plan_version_id>:<rule_key>' (the rule id relationship rows and refusals carry). */
  readonly rule_id: string
  readonly params: z.infer<(typeof STRUCTURAL_RULES)[K]>
}

/** D-B3-07: the rules of a structural kind in the versions in force at `at` of every plan covering the market. */
export async function structuralRules<K extends StructuralRuleKind>(
  tx: Tx, marketId: string, at: Date | string, kind: K,
): Promise<StructuralRule<K>[]> {
  const { rows } = await tx.query<{ rule_id: string; params: unknown }>(
    `SELECT plan_version_id::text || ':' || rule_key AS rule_id, params FROM plan_rules_in_force($1, $2, $3)`, [marketId, at, kind],
  )
  return rows.map((row) => ({ rule_id: row.rule_id, params: STRUCTURAL_RULES[kind].parse(row.params) as StructuralRule<K>['params'] }))
}
