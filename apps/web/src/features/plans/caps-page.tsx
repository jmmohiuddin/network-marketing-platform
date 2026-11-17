'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { KpiCard } from '../../components/kpi-card'
import { ConfirmDialog } from '../../components/modal'
import { PageHeader } from '../../components/page-header'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { countLabel } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { isUuid } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { CapForm, PoolForm } from './caps-forms'
import { CAP_METHOD_LABELS, currencyOf, money, simulationPage, STATE_LABELS, versionApi, versionPage, type Currency } from './format'
import type { DraftScope } from './rules-tab'
import { RunSimulationDialog, SIMULATIONS_PATH, simulationPeriod } from './simulations'
import type { CapEffect, PlanDetail, Rule, SimulationDetail, VersionView } from './types'
import { CardHead, ifMatch, MONO, NOTE, reloadedIfStale, usePlanData, type PlanData } from './ui'

/** Caps in precedence order: ordinal, then key (overlapping caps need distinct ordinals, AC-PLN4-1). */
export const capsInOrder = (rules: readonly Rule[]): Rule[] =>
  rules.filter((r) => r.kind === 'cap').sort((a, b) => a.ordinal - b.ordinal || a.rule_key.localeCompare(b.rule_key))

/** Ordinal writes that make `order` the precedence: position i gets ordinal i (only rules whose ordinal changes). */
export function ordinalWrites(order: readonly Rule[]): { readonly rule: Rule; readonly ordinal: number }[] {
  return order.flatMap((rule, ordinal) => (rule.ordinal === ordinal ? [] : [{ rule, ordinal }]))
}

const removed = (cap: CapEffect): bigint => cap.affected.reduce((sum, a) => sum + BigInt(a.before_minor) - BigInt(a.after_minor), 0n)

/** Preview: cap effects of a simulation of this version on an ended period (BR-CAP-03). */
function Preview({ planId, version, simulationId, currency }: { readonly planId: string; readonly version: VersionView; readonly simulationId: string; readonly currency: Currency | null }) {
  const detail = useResource<SimulationDetail>(`${SIMULATIONS_PATH}/${simulationId}`, undefined, (d) => d.simulation.state === 'queued' || d.simulation.state === 'running')
  if (detail.error !== null) return <LoadFailure error={detail.error} onRetry={detail.reload} section />
  if (detail.data === null) return <LoadingState label="Loading the preview" />
  const { simulation, comparison } = detail.data
  if (simulation.state === 'queued' || simulation.state === 'running') return <p role="status" className={NOTE}>The preview is calculating. This page updates when it finishes.</p>
  if (simulation.state === 'failed') return <Banner tone="danger" title="The preview failed">{simulation.error?.message ?? 'The simulation did not complete.'}</Banner>
  if (simulation.plan_version_id !== version.id) return <p className={NOTE}>This preview is a simulation of another version. Choose Preview on period to simulate this one.</p>
  const effects = comparison?.cap_effects ?? []
  const columns: readonly DataTableColumn<CapEffect>[] = [
    { key: 'cap', header: 'Cap', cell: (c) => <span className={MONO}>{c.cap_key}</span> },
    { key: 'bound', header: 'Bound', cell: (c) => (c.bound ? 'Yes' : 'No') },
    { key: 'payees', header: 'Payees affected', align: 'end', cell: (c) => String(new Set(c.affected.map((a) => a.payee_position_id)).size) },
    { key: 'removed', header: 'Removed', align: 'end', cell: (c) => money(removed(c).toString(), currency) },
  ]
  return (
    <div className="flex flex-col gap-space-sm">
      <DataTable caption="Cap effects of the preview" columns={columns} rows={effects} rowKey={(c) => c.cap_key} empty={{ title: 'No cap applied in this period.' }} density="compact" bare />
      <Link className="font-body-sm text-body-sm font-semibold text-primary hover:underline" href={simulationPage(planId, version.version, simulationId)}>Open the full simulation</Link>
    </div>
  )
}

const moveButtonId = (key: string, by: -1 | 1) => `move-${key}-${by < 0 ? 'up' : 'down'}`

/** One cap in the precedence list (sc_05 ladder row) with Move up / Move down. */
function CapRow({ cap, index, count, canEdit, busy, errors, onMove, onEdit, onDelete }: {
  readonly cap: Rule; readonly index: number; readonly count: number; readonly canEdit: boolean; readonly busy: boolean; readonly errors: readonly string[]
  readonly onMove: (by: -1 | 1) => void; readonly onEdit: () => void; readonly onDelete: () => void
}) {
  const method = (cap.params.method as { type?: string } | undefined)?.type ?? ''
  return (
    <li className="flex flex-col gap-space-xs p-space-sm bg-surface-container-low rounded">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm min-w-0">
          <span className={`w-6 h-6 rounded bg-surface-container-high text-primary ${MONO} flex items-center justify-center font-bold shrink-0`}>{index + 1}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-body-sm text-body-sm font-semibold text-on-surface">{cap.rule_key}</span>
              <span className={`px-1.5 rounded bg-surface-container-high text-primary ${MONO} text-[10px]`}>{CAP_METHOD_LABELS[method] ?? method}</span>
            </div>
            <span className="font-caption text-[11px] text-secondary">{cap.rendering}</span>
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-space-xs shrink-0">
            <Button id={moveButtonId(cap.rule_key, -1)} size="sm" icon="arrow_upward" aria-label={`Move ${cap.rule_key} up`} disabled={index === 0 || busy} onClick={() => onMove(-1)}>Up</Button>
            <Button id={moveButtonId(cap.rule_key, 1)} size="sm" icon="arrow_downward" aria-label={`Move ${cap.rule_key} down`} disabled={index === count - 1 || busy} onClick={() => onMove(1)}>Down</Button>
            <Button size="sm" icon="edit" aria-label={`Edit cap ${cap.rule_key}`} disabled={busy} onClick={onEdit}>Edit</Button>
            <Button size="sm" variant="destructive" aria-label={`Delete cap ${cap.rule_key}`} disabled={busy} onClick={onDelete}>Delete</Button>
          </div>
        )}
      </div>
      {errors.map((message) => <p key={message} className="font-caption text-caption text-error">{message}</p>)}
    </li>
  )
}

type Editing = { readonly kind: 'cap'; readonly rule: Rule | null } | { readonly kind: 'pool'; readonly rule: Rule | null }

function CapsScreen({ plan, version, data }: { readonly plan: PlanDetail; readonly version: VersionView; readonly data: PlanData }) {
  const api = useApi()
  const toast = useToast()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { can, readOnly } = useSession()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [deleting, setDeleting] = useState<Rule | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [moved, setMoved] = useState<{ readonly key: string; readonly by: -1 | 1 } | null>(null)
  const [failure, setFailure] = useState<{ readonly error: unknown; readonly partial: boolean } | null>(null)
  const reload = () => data.version.reload()
  const scope: DraftScope = { plan, version, canEdit: version.state === 'draft' && can('plan.edit') && !readOnly, reload }
  const caps = capsInOrder(version.rules)
  const pools = version.rules.filter((r) => r.kind === 'pay.pool')
  // Only an id goes into the API path: anything else (dot segments, '?') would reach another endpoint.
  const preview = params.get('preview')
  const previewId = preview !== null && isUuid(preview) ? preview : null
  const previewCurrency = currencyOf(previewId === null ? undefined : simulationPeriod(version, previewId)?.calendar_id, plan.calendars, data.markets.data)
  const errorsOf = (key: string) => version.validation.errors.filter((e) => e.rule_key === key).map((e) => e.message)
  const canPreview = can('plan.simulate') && can('period.read') && !readOnly

  // Disabled and re-ordered buttons drop focus to <body>: give it back to the moved cap's button once the new order shows.
  useEffect(() => {
    if (moved === null || moving || document.activeElement !== document.body) return
    const button = (by: -1 | 1) => document.getElementById(moveButtonId(moved.key, by)) as HTMLButtonElement | null
    const same = button(moved.by)
    ;(same !== null && !same.disabled ? same : button(moved.by < 0 ? 1 : -1))?.focus()
  }, [moved, moving, version.revision])

  /** Each write moves the revision on: the next write sends the ETag of the one before (If-Match chain). */
  async function move(index: number, by: -1 | 1) {
    const order = [...caps]
    ;[order[index], order[index + by]] = [order[index + by]!, order[index]!]
    setMoving(true)
    setMoved({ key: caps[index]!.rule_key, by })
    setFailure(null)
    let revision = version.revision
    let saved = 0
    try {
      for (const { rule, ordinal } of ordinalWrites(order)) {
        const { headers } = await api.put(`${versionApi(plan.id, version.version)}/rules/${rule.rule_key}`, {
          kind: rule.kind, params: rule.params, reversal_policy: rule.reversal_policy, calendar_id: rule.calendar_id, ordinal,
        }, { headers: ifMatch({ revision }) })
        saved += 1
        // The revision digits of "7" or a weak W/"7"; none makes the next write fail with 412 rather than guess.
        revision = Number(/(\d+)/.exec(headers.get('etag') ?? '')?.[1] ?? Number.NaN)
      }
      toast({ message: `${order[index + by]!.rule_key} moved ${by < 0 ? 'up' : 'down'}.` })
    } catch (error) {
      setFailure({ error: reloadedIfStale(error, reload), partial: saved > 0 })
    } finally {
      setMoving(false)
      reload()
    }
  }
  async function remove(rule: Rule) {
    try {
      await api.delete(`${versionApi(plan.id, version.version)}/rules/${rule.rule_key}`, { headers: ifMatch(version) })
    } catch (error) {
      throw reloadedIfStale(error, reload)
    }
    toast({ message: `${rule.rule_key} deleted.` })
    setDeleting(null)
    reload()
  }
  const methods = [...new Set(caps.map((c) => CAP_METHOD_LABELS[(c.params.method as { type?: string } | undefined)?.type ?? ''] ?? ''))].filter(Boolean)
  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        breadcrumbs={[{ label: 'Plans', href: '/plans' }, { label: plan.name }, { label: `Version ${version.version}`, href: versionPage(plan.id, version.version) }, { label: 'Caps and pools' }]}
        title="Caps and pools"
        state={<StatusBadge state={version.state} label={STATE_LABELS[version.state]} />}
        summary={`${plan.name}, version ${version.version}: ceilings on bonuses in precedence order and pools shared by qualifying payees.`}
        actions={(
          <>
            {canPreview && <Button icon="query_stats" variant={scope.canEdit ? 'secondary' : 'primary'} data-testid={scope.canEdit ? undefined : 'primary-action'} onClick={() => setPreviewing(true)}>Preview on period</Button>}
            {scope.canEdit && <Button variant="primary" icon="add" data-testid="primary-action" onClick={() => setEditing({ kind: 'cap', rule: null })}>Add cap</Button>}
          </>
        )}
      />
      {failure !== null && (
        <Banner tone="danger" title={failure.partial ? 'The new order was saved only in part; check it and try again.' : 'The order was not saved'}>{errorMessage(failure.error)}</Banner>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md" data-testid="kpis">
        <KpiCard label="Caps and pools" value={`${countLabel(caps.length, 'cap')} · ${countLabel(pools.length, 'pool')}`} icon="toll" />
        <KpiCard label="Cap methods" value={methods.length === 0 ? null : methods.join(', ')} icon="waterfall_chart" detail={methods.length === 0 ? 'No cap yet' : undefined} />
        <KpiCard label="Precedence" value={caps.length < 2 ? null : 'Ordered'} icon="format_list_numbered" detail={caps.length < 2 ? 'Set when two caps overlap' : 'Caps apply top to bottom'} />
        <KpiCard label="Residue" value="Breakage" icon="account_balance" detail="Removed amounts are not earned." />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
        <div className="lg:col-span-8 flex flex-col gap-space-lg">
          {editing?.kind === 'cap' && <CapForm key={editing.rule?.rule_key ?? 'new'} scope={scope} cap={editing.rule} ordinal={editing.rule?.ordinal ?? caps.reduce((next, c) => Math.max(next, c.ordinal + 1), 0)} onDone={() => setEditing(null)} />}
          <section aria-labelledby="caps-title" className="bg-surface-container-lowest rounded shadow-sm overflow-hidden" data-testid="card">
            <div className="p-space-md bg-surface-container-low"><CardHead id="caps-title" icon="tune" title="Caps in precedence order" note="Overlapping caps apply from the top; move a cap to change its precedence." /></div>
            <div className="p-space-md">
              {caps.length === 0
                ? <p className={NOTE}>No cap in this version.</p>
                : <ol aria-label="Caps in precedence order" className="space-y-1.5">{caps.map((cap, index) => (
                  <CapRow key={cap.rule_key} cap={cap} index={index} count={caps.length} canEdit={scope.canEdit} busy={moving} errors={errorsOf(cap.rule_key)}
                    onMove={(by) => void move(index, by)} onEdit={() => setEditing({ kind: 'cap', rule: cap })} onDelete={() => setDeleting(cap)} />
                ))}</ol>}
            </div>
          </section>
          {editing?.kind === 'pool' && <PoolForm key={editing.rule?.rule_key ?? 'new'} scope={scope} pool={editing.rule} onDone={() => setEditing(null)} />}
          <section aria-labelledby="pools-title" className="bg-surface-container-lowest rounded shadow-sm overflow-hidden">
            <div className="p-space-md bg-surface-container-low">
              <CardHead id="pools-title" icon="pie_chart" title="Pools" note="Shares of a market total, divided by rank or among the first payees."
                aside={scope.canEdit ? <Button icon="add" onClick={() => setEditing({ kind: 'pool', rule: null })}>Add pool</Button> : undefined} />
            </div>
            <ul className="p-space-md space-y-1.5">
              {pools.length === 0 && <li className={NOTE}>No pool in this version.</li>}
              {pools.map((pool) => (
                <li key={pool.rule_key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm p-space-sm bg-surface-container-low rounded">
                  <div className="min-w-0">
                    <span className="font-body-sm text-body-sm font-semibold text-on-surface">{pool.rule_key}</span>
                    <p className="font-caption text-[11px] text-secondary">{pool.rendering}</p>
                    {errorsOf(pool.rule_key).map((message) => <p key={message} className="font-caption text-caption text-error">{message}</p>)}
                  </div>
                  {scope.canEdit && (
                    <span className="flex gap-space-xs shrink-0">
                      <Button size="sm" icon="edit" aria-label={`Edit pool ${pool.rule_key}`} disabled={moving} onClick={() => setEditing({ kind: 'pool', rule: pool })}>Edit</Button>
                      <Button size="sm" variant="destructive" aria-label={`Delete pool ${pool.rule_key}`} disabled={moving} onClick={() => setDeleting(pool)}>Delete</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <section aria-labelledby="preview-title" className="lg:col-span-4 bg-surface-container-lowest rounded shadow-sm overflow-hidden">
          <div className="p-space-md bg-surface-container-low"><CardHead id="preview-title" icon="visibility" title="Preview" note="Simulated on an ended period: payees affected and amounts removed per cap." /></div>
          <div className="p-space-md">
            {previewId === null
              ? <p className={NOTE}>{canPreview ? 'Choose Preview on period to simulate this version and see what each cap removes.' : 'Previews need the plan simulation permission.'}</p>
              : <Preview planId={plan.id} version={version} simulationId={previewId} currency={previewCurrency} />}
          </div>
        </section>
      </div>
      {previewing && (
        <RunSimulationDialog plan={plan} versionId={version.id} title="Preview on period" onClose={() => setPreviewing(false)}
          onCreated={(simulation) => {
            setPreviewing(false)
            reload() // its period (and so its currency) comes with the version's simulations
            router.replace(`${pathname}?preview=${simulation.id}`)
          }} />
      )}
      <ConfirmDialog open={deleting !== null} title={`Delete ${deleting?.rule_key ?? ''}`} consequence="The rule is removed from this draft."
        confirmLabel="Delete" destructive onConfirm={() => remove(deleting!)} onCancel={() => setDeleting(null)} />
    </div>
  )
}

/** SC-05 caps and pools of one version. */
export function CapsPage({ planId, version: number }: { readonly planId: string; readonly version: number }) {
  const data = usePlanData(planId, number)
  const { plan, version } = data
  if (plan.error !== null || version.error !== null) return <LoadFailure error={plan.error ?? version.error} onRetry={() => { plan.reload(); version.reload() }} />
  if (plan.data === null || version.data === null) return <LoadingState label="Loading caps and pools" />
  return <CapsScreen plan={plan.data} version={version.data} data={data} />
}
