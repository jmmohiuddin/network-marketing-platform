'use client'

import { useState } from 'react'
import { Select } from '../../components/form-field'
import { LoadingState } from '../../components/states'
import { useResource } from '../../lib/use-resource'
import { LoadFailure } from '../admin/page-states'
import { kindLabel, STATE_LABELS, versionApi } from './format'
import type { DiffView, PlanDetail, Rule, Transition } from './types'
import { CAPTION, CARD, H2, MONO, NOTE } from './ui'

const FIELD_LABELS: Readonly<Record<string, string>> = {
  crediting_event: 'Crediting event', placement_width: 'Placement width', effective_from: 'Effective from', justification: 'Justification', engine_version: 'Engine version',
}
const fieldText = (value: unknown): string => (value === null || value === undefined ? 'Not set' : String(value))
const transitionText = (t: Transition): string => `${t.rule}${t.map.length > 0 ? ` (${t.map.map((m) => `${m.from} → ${m.to}`).join(', ')})` : ''}${t.reason === null ? '' : `: ${t.reason}`}`

/** sc_04 diff box: the earlier version on the left, this version on the right. */
function DiffBox({ before, after, beforeLabel, afterLabel }: { readonly before: string; readonly after: string; readonly beforeLabel: string; readonly afterLabel: string }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-space-xs font-body-sm text-body-sm">
      <div className="bg-surface-container-highest p-space-sm rounded space-y-1">
        <div className="font-caption text-caption text-secondary uppercase font-semibold">{beforeLabel}</div>
        <p className={`${MONO} text-on-surface break-words`}>{before}</p>
      </div>
      <div className="bg-surface-container-high p-space-sm rounded space-y-1">
        <div className="font-caption text-caption text-primary uppercase font-semibold">{afterLabel}</div>
        <p className={`${MONO} text-on-surface font-semibold break-words`}>{after}</p>
      </div>
    </div>
  )
}

function RuleLine({ rule, change }: { readonly rule: Rule; readonly change: 'Added' | 'Removed' }) {
  return (
    <li className="p-space-sm rounded bg-surface-container-low flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2"><span className={`${MONO} font-bold text-primary`}>{rule.rule_key}</span><span className="font-body-sm text-body-sm font-semibold">{kindLabel(rule.kind)}</span></span>
        <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${change === 'Added' ? 'bg-primary text-on-primary' : 'bg-surface-container text-secondary'}`}>{change}</span>
      </div>
      <p className="font-body-sm text-body-sm text-on-surface">{rule.rendering}</p>
    </li>
  )
}

function Diff({ diff, against, version }: { readonly diff: DiffView; readonly against: number; readonly version: number }) {
  const labels = { beforeLabel: `Version ${against}`, afterLabel: `Version ${version}` }
  const { rules, transitions } = diff
  const nothing = diff.fields.length + rules.added.length + rules.removed.length + rules.changed.length + transitions.added.length + transitions.removed.length + transitions.changed.length === 0
  if (nothing) return <p className={`${CARD} ${NOTE}`}>Versions {against} and {version} have the same rules, transitions and fields.</p>
  return (
    <div className="flex flex-col gap-space-md">
      {diff.fields.length > 0 && (
        <section className={CARD} aria-labelledby="diff-fields">
          <h2 id="diff-fields" className={H2}>Version fields</h2>
          <ul className="flex flex-col gap-space-sm">
            {diff.fields.map((f) => <li key={f.name} className="flex flex-col gap-1"><span className={CAPTION}>{FIELD_LABELS[f.name] ?? f.name}</span><DiffBox before={fieldText(f.before)} after={fieldText(f.after)} {...labels} /></li>)}
          </ul>
        </section>
      )}
      {rules.added.length + rules.removed.length + rules.changed.length > 0 && (
        <section className={CARD} aria-labelledby="diff-rules">
          <h2 id="diff-rules" className={H2}>Rules</h2>
          <ul className="flex flex-col gap-space-sm">
            {rules.changed.map((c) => (
              <li key={c.rule_key} className="p-space-sm rounded bg-surface-container-low flex flex-col gap-space-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><span className={`${MONO} font-bold text-primary`}>{c.rule_key}</span><span className="font-body-sm text-body-sm font-semibold">{kindLabel(c.after.kind)}</span></span>
                  <span className="px-2 py-0.5 rounded bg-primary text-on-primary text-[11px] font-bold uppercase tracking-wider">Changed</span>
                </div>
                <DiffBox before={c.rendering_before} after={c.rendering_after} {...labels} />
              </li>
            ))}
            {rules.added.map((r) => <RuleLine key={r.rule_key} rule={r} change="Added" />)}
            {rules.removed.map((r) => <RuleLine key={r.rule_key} rule={r} change="Removed" />)}
          </ul>
        </section>
      )}
      {transitions.added.length + transitions.removed.length + transitions.changed.length > 0 && (
        <section className={CARD} aria-labelledby="diff-transitions">
          <h2 id="diff-transitions" className={H2}>Transitions</h2>
          <ul className="flex flex-col gap-space-sm">
            {transitions.changed.map((c) => <li key={c.state_item} className="flex flex-col gap-1"><span className={MONO}>{c.state_item}</span><DiffBox before={transitionText(c.before)} after={transitionText(c.after)} {...labels} /></li>)}
            {transitions.added.map((t) => <li key={t.state_item} className={NOTE}>Added <span className={MONO}>{t.state_item}</span>: {transitionText(t)}</li>)}
            {transitions.removed.map((t) => <li key={t.state_item} className={NOTE}>Removed <span className={MONO}>{t.state_item}</span>: {transitionText(t)}</li>)}
          </ul>
        </section>
      )}
    </div>
  )
}

/** SC-04 Compare tab: GET …/diff?against=<version> for any other version of the plan (AC-PLN1-5). */
export function CompareTab({ plan, version }: { readonly plan: PlanDetail; readonly version: number }) {
  const others = plan.versions.filter((v) => v.version !== version)
  const [against, setAgainst] = useState<number | null>(others[0]?.version ?? null)
  const diff = useResource<DiffView>(against === null ? null : `${versionApi(plan.id, version)}/diff`, { against: against ?? undefined })
  if (others.length === 0) return <p className={`${CARD} ${NOTE}`}>This plan has no other version to compare with.</p>
  return (
    <div className="flex flex-col gap-space-md">
      <div className={`${CARD} sm:max-w-md`}>
        <Select label="Compare with" value={String(against)} options={others.map((v) => ({ value: String(v.version), label: `Version ${v.version} (${STATE_LABELS[v.state]})` }))} onChange={(event) => setAgainst(Number(event.target.value))} />
      </div>
      {diff.loading && <LoadingState label="Comparing versions" />}
      {diff.error !== null && <LoadFailure error={diff.error} onRetry={diff.reload} section />}
      {diff.data !== null && against !== null && <Diff diff={diff.data} against={against} version={version} />}
    </div>
  )
}
