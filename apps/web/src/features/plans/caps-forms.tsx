'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { ErrorSummary } from '../../components/error-summary'
import { Checkbox, RadioGroup, Select, TextInput } from '../../components/form-field'
import { Icon } from '../../components/icon'
import { useToast } from '../../components/toast'
import { CHECK_GRID, FIELDSET, LEGEND } from '../admin/ui'
import { isBonus, isMeasure, REVERSAL_LABELS, versionApi } from './format'
import { ruleKeyIssue, type DraftScope } from './rules-tab'
import type { Rule } from './types'
import { CardHead, ifMatch, MONO, NOTE, RefusalBanner, reloadedIfStale } from './ui'

const DECIMAL = /^(0|[1-9]\d{0,17})(\.\d{1,6})?$/

type Issues = Record<string, string>
const decimalIssue = (value: string, what: string): string | null => (DECIMAL.test(value) ? null : `Enter ${what} as a decimal such as 0.10 (up to 6 decimals).`)
const options = (rules: readonly Rule[]) => rules.map((r) => ({ value: r.rule_key, label: r.rule_key }))

/** An ordered list with Move up / Move down buttons (no drag-only reordering). */
function OrderedList({ label, items, onChange }: { readonly label: string; readonly items: readonly string[]; readonly onChange: (items: readonly string[]) => void }) {
  const move = (index: number, by: -1 | 1) => {
    const next = [...items]
    ;[next[index], next[index + by]] = [next[index + by]!, next[index]!]
    onChange(next)
  }
  return (
    <ol aria-label={label} className="space-y-1.5">
      {items.map((item, index) => (
        <li key={item} className="flex items-center justify-between p-space-sm bg-surface-container-low rounded">
          <span className="flex items-center gap-space-sm">
            <span className={`w-6 h-6 rounded bg-surface-container-high text-primary ${MONO} flex items-center justify-center font-bold`}>{index + 1}</span>
            <span className="font-body-sm text-body-sm font-semibold text-on-surface">{item}</span>
          </span>
          <span className="flex items-center gap-space-xs">
            <Button size="sm" icon="arrow_upward" aria-label={`Move ${item} up`} disabled={index === 0} onClick={() => move(index, -1)}>Up</Button>
            <Button size="sm" icon="arrow_downward" aria-label={`Move ${item} down`} disabled={index === items.length - 1} onClick={() => move(index, 1)}>Down</Button>
          </span>
        </li>
      ))}
    </ol>
  )
}

interface SaveRule {
  readonly scope: DraftScope
  readonly key: string
  readonly kind: 'cap' | 'pay.pool'
  readonly params: Readonly<Record<string, unknown>>
  readonly ordinal: number
  readonly reversal: string | null
  readonly calendar: string
}

/** PUT …/rules/:key with If-Match; the form shows refusals itself. */
function useRuleSave(onSaved: () => void) {
  const api = useApi()
  const toast = useToast()
  const [failure, setFailure] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  async function save(rule: SaveRule) {
    setBusy(true)
    setFailure(null)
    try {
      await api.put(`${versionApi(rule.scope.plan.id, rule.scope.version.version)}/rules/${rule.key}`, {
        kind: rule.kind, params: rule.params, ordinal: rule.ordinal, reversal_policy: rule.reversal, calendar_id: rule.calendar === '' ? null : rule.calendar,
      }, { headers: ifMatch(rule.scope.version) })
      toast({ message: `${rule.kind === 'cap' ? 'Cap' : 'Pool'} ${rule.key} saved.` })
      onSaved()
      rule.scope.reload()
    } catch (error) {
      setFailure(reloadedIfStale(error, rule.scope.reload))
    } finally {
      setBusy(false)
    }
  }
  return { failure, busy, save }
}

function FormCard({ icon, title, note, issues, failure, busy, onCancel, onSubmit, children, submitLabel }: {
  readonly icon: string; readonly title: string; readonly note: string; readonly issues: Issues; readonly failure: unknown; readonly busy: boolean
  readonly onCancel: () => void; readonly onSubmit: () => void; readonly children: ReactNode; readonly submitLabel: string
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit()
  }
  return (
    <form className="bg-surface-container-lowest rounded shadow-sm overflow-hidden" onSubmit={submit} noValidate aria-label={title}>
      <div className="p-space-md bg-surface-container-low"><CardHead icon={icon} title={title} note={note} /></div>
      <div className="p-space-md space-y-space-md">
        <ErrorSummary items={Object.entries(issues).map(([fieldId, message]) => ({ fieldId, message }))} />
        {failure !== null && <RefusalBanner error={failure} title="Not saved" />}
        {children}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" icon="save" loading={busy}>{submitLabel}</Button>
        </div>
      </div>
    </form>
  )
}

interface CapBase { readonly kind: 'measure'; readonly measure: string }
interface StructureBase { readonly kind: 'order_structure'; readonly first: string; readonly second: string; readonly secondShareAbove: { readonly num: number; readonly den: number }; readonly firstMultiplier: string }
interface CapParams { readonly scope: readonly string[]; readonly base: CapBase | StructureBase; readonly rate: string; readonly method: { readonly type: string; readonly reduce?: readonly string[] } }

/** Cap form (pass 8, BR-CAP-01..03): scope, base, rate, method and priority order; residue is breakage. */
export function CapForm({ scope, cap, ordinal, onDone }: { readonly scope: DraftScope; readonly cap: Rule | null; readonly ordinal: number; readonly onDone: () => void }) {
  const initial = (cap?.params ?? {}) as Partial<CapParams>
  const structure = initial.base?.kind === 'order_structure' ? initial.base : null
  const bonuses = scope.version.rules.filter((r) => isBonus(r.kind))
  const measures = scope.version.rules.filter((r) => isMeasure(r.kind))
  const [key, setKey] = useState(cap?.rule_key ?? '')
  const savedScope = initial.method?.reduce ?? initial.scope ?? []
  // A deleted bonus has no checkbox to clear it, so it leaves the scope here and the form says so.
  const removedKeys = savedScope.filter((k) => !bonuses.some((b) => b.rule_key === k))
  const [bonusKeys, setBonusKeys] = useState<readonly string[]>(() => savedScope.filter((k) => !removedKeys.includes(k)))
  const [baseKind, setBaseKind] = useState<string>(initial.base?.kind ?? 'measure')
  const [measure, setMeasure] = useState(initial.base?.kind === 'measure' ? initial.base.measure : '')
  const [first, setFirst] = useState(structure?.first ?? '')
  const [second, setSecond] = useState(structure?.second ?? '')
  const [num, setNum] = useState(String(structure?.secondShareAbove.num ?? ''))
  const [den, setDen] = useState(String(structure?.secondShareAbove.den ?? ''))
  const [multiplier, setMultiplier] = useState(structure?.firstMultiplier ?? '')
  const [rate, setRate] = useState(initial.rate ?? '')
  const [method, setMethod] = useState<string>(initial.method?.type ?? 'proportional')
  const [calendar, setCalendar] = useState(cap?.calendar_id ?? '')
  const [issues, setIssues] = useState<Issues>({})
  const { failure, busy, save } = useRuleSave(onDone)
  function submit() {
    const found: Issues = {}
    const add = (id: string, message: string | null) => {
      if (message !== null) found[id] = message
    }
    add('cap-key', ruleKeyIssue(key, scope.version.rules, cap === null))
    add('cap-scope', bonusKeys.length === 0 ? 'Choose at least one bonus the cap limits.' : null)
    add('cap-rate', decimalIssue(rate, 'the rate'))
    if (baseKind === 'measure') add('cap-measure', measure === '' ? 'Choose the measure the cap is a share of.' : null)
    else {
      add('cap-first', first === '' ? 'Choose the first measure of the order structure.' : null)
      add('cap-second', second === '' ? 'Choose the second measure of the order structure.' : null)
      add('cap-share', /^\d+$/.test(num) ? null : 'Enter the second share as a whole number, for example 1.')
      add('cap-share-of', /^[1-9]\d*$/.test(den) ? null : 'Enter what the share is out of as a whole number from 1, for example 2.')
      add('cap-multiplier', decimalIssue(multiplier, 'the multiplier'))
    }
    setIssues(found)
    if (Object.keys(found).length > 0) return
    const base = baseKind === 'measure' ? { kind: 'measure', measure } : { kind: 'order_structure', first, second, secondShareAbove: { num: Number(num), den: Number(den) }, firstMultiplier: multiplier }
    const params = { scope: bonusKeys, base, rate, method: method === 'priority' ? { type: 'priority', reduce: bonusKeys } : { type: method }, residue: 'breakage' }
    void save({ scope, key, kind: 'cap', params, ordinal, reversal: null, calendar })
  }
  return (
    <FormCard icon="tune" title={cap === null ? 'New cap' : `Cap ${cap.rule_key}`} note="A ceiling on the bonuses in its scope, applied after participant limits."
      issues={issues} failure={failure} busy={busy} onCancel={onDone} onSubmit={submit} submitLabel="Save cap">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
        <TextInput id="cap-key" label="Cap key" value={key} readOnly={cap !== null} error={issues['cap-key']} onChange={(event) => setKey(event.target.value)} />
        <TextInput id="cap-rate" label="Rate" inputMode="decimal" value={rate} error={issues['cap-rate']} helper="Share of the base, for example 0.10 for 10%." onChange={(event) => setRate(event.target.value)} />
      </div>
      <fieldset id="cap-scope" tabIndex={-1} className={FIELDSET} aria-describedby={issues['cap-scope'] === undefined ? undefined : 'cap-scope-error'}>
        <legend className={LEGEND}>Bonuses in scope</legend>
        {bonuses.length === 0 && <p className={NOTE}>Add the bonuses first; a cap limits bonuses.</p>}
        {removedKeys.length > 0 && <p role="status" className={NOTE}>{removedKeys.join(', ')} no longer {removedKeys.length === 1 ? 'exists' : 'exist'} and {removedKeys.length === 1 ? 'was' : 'were'} removed from the scope. Save the cap to keep this change.</p>}
        <div className={CHECK_GRID}>
          {bonuses.map((b) => (
            <Checkbox key={b.rule_key} label={b.rule_key} helper={b.rendering} checked={bonusKeys.includes(b.rule_key)}
              onChange={(event) => setBonusKeys(event.target.checked ? [...bonusKeys, b.rule_key] : bonusKeys.filter((k) => k !== b.rule_key))} />
          ))}
        </div>
        {issues['cap-scope'] !== undefined && <p id="cap-scope-error" className="font-caption text-caption text-error">{issues['cap-scope']}</p>}
      </fieldset>
      <RadioGroup legend="Base" name="cap-base" value={baseKind} onChange={setBaseKind} options={[
        { value: 'measure', label: 'A measure', helper: 'The market total of the measure; the payee’s own value for a per-person cap.' },
        { value: 'order_structure', label: 'Order structure module', helper: 'Two measures: the first times a multiplier when the second’s share is above a threshold, else their sum.' },
      ]} />
      {baseKind === 'measure'
        ? <Select id="cap-measure" label="Base measure" value={measure} placeholder="Choose a measure" error={issues['cap-measure']} options={options(measures)} onChange={(event) => setMeasure(event.target.value)} />
        : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
            <Select id="cap-first" label="First measure" value={first} placeholder="Choose a measure" error={issues['cap-first']} options={options(measures)} onChange={(event) => setFirst(event.target.value)} />
            <Select id="cap-second" label="Second measure" value={second} placeholder="Choose a measure" error={issues['cap-second']} options={options(measures)} onChange={(event) => setSecond(event.target.value)} />
            <div className="grid grid-cols-2 gap-space-sm">
              <TextInput id="cap-share" label="Second share above" inputMode="numeric" value={num} error={issues['cap-share']} onChange={(event) => setNum(event.target.value)} />
              <TextInput id="cap-share-of" label="Out of" inputMode="numeric" value={den} error={issues['cap-share-of']} onChange={(event) => setDen(event.target.value)} />
            </div>
            <TextInput id="cap-multiplier" label="First multiplier" inputMode="decimal" value={multiplier} error={issues['cap-multiplier']} onChange={(event) => setMultiplier(event.target.value)} />
          </div>
        )}
      <RadioGroup legend="Method" name="cap-method" value={method} onChange={setMethod} options={[
        { value: 'proportional', label: 'Proportional', helper: 'Every line in scope is scaled down by the same factor.' },
        { value: 'priority', label: 'Priority', helper: 'Bonuses are reduced in the order below until the cap is met.' },
        { value: 'per_person', label: 'Per person', helper: 'Each payee’s lines in scope are capped at the rate of the payee’s own measure.' },
      ]} />
      {method === 'priority' && bonusKeys.length > 0 && (
        <div className="flex flex-col gap-space-xs">
          <p className="font-section-heading text-section-heading text-on-surface">Priority order</p>
          <p className={NOTE}>The first bonus is reduced first; the order covers every bonus in scope.</p>
          <OrderedList label="Priority order" items={bonusKeys} onChange={setBonusKeys} />
        </div>
      )}
      <Select label="Calendar" value={calendar} options={[{ value: '', label: 'Every plan calendar' }, ...scope.plan.calendars.map((c) => ({ value: c.id, label: c.name }))]} onChange={(event) => setCalendar(event.target.value)} />
      <div className="p-space-sm rounded bg-surface-container-low flex items-start gap-space-sm">
        <Icon name="account_balance" size={20} className="text-secondary mt-0.5" />
        <p className="font-body-sm text-body-sm text-on-surface"><span className="font-semibold">Residue:</span> Breakage — removed amounts are not earned.</p>
      </div>
    </FormCard>
  )
}

interface PoolParams {
  readonly baseMeasure: string
  readonly rate: string
  readonly eligibleIf: { readonly ladder: string; readonly rank: string } | null
  readonly allocation: { readonly type: 'shares'; readonly ladder: string; readonly shares: readonly { readonly rank: string; readonly shares: number }[] }
    | { readonly type: 'rank_order'; readonly ladder: string; readonly parts: readonly { readonly rank: string; readonly share: string }[] }
    | { readonly type: 'first_n'; readonly n: number; readonly orderBy: string }
}
interface RankRow { readonly rank: string; readonly value: string }

const ranksOf = (rules: readonly Rule[], ladder: string): string[] =>
  ((rules.find((r) => r.kind === 'ladder' && r.rule_key === ladder)?.params.ranks ?? []) as readonly { readonly key: string }[]).map((r) => r.key)

/** Pool form (pass 6, pay.pool): base measure, rate and allocation by shares, rank order or first N. */
export function PoolForm({ scope, pool, onDone }: { readonly scope: DraftScope; readonly pool: Rule | null; readonly onDone: () => void }) {
  const initial = (pool?.params ?? {}) as Partial<PoolParams>
  const a = initial.allocation
  const ladders = scope.version.rules.filter((r) => r.kind === 'ladder')
  const measures = scope.version.rules.filter((r) => isMeasure(r.kind))
  const [key, setKey] = useState(pool?.rule_key ?? '')
  const [baseMeasure, setBaseMeasure] = useState(initial.baseMeasure ?? '')
  const [rate, setRate] = useState(initial.rate ?? '')
  const [type, setType] = useState<string>(a?.type ?? 'shares')
  const [ladder, setLadder] = useState(a !== undefined && a.type !== 'first_n' ? a.ladder : ladders[0]?.rule_key ?? '')
  const [rows, setRows] = useState<readonly RankRow[]>(a?.type === 'shares' ? a.shares.map((s) => ({ rank: s.rank, value: String(s.shares) })) : a?.type === 'rank_order' ? a.parts.map((p) => ({ rank: p.rank, value: p.share })) : [])
  const [n, setN] = useState(a?.type === 'first_n' ? String(a.n) : '')
  const [orderBy, setOrderBy] = useState(a?.type === 'first_n' ? a.orderBy : '')
  const [eligible, setEligible] = useState(initial.eligibleIf === undefined || initial.eligibleIf === null ? '' : `${initial.eligibleIf.ladder}|${initial.eligibleIf.rank}`)
  const [reversal, setReversal] = useState(pool?.reversal_policy ?? '')
  const [issues, setIssues] = useState<Issues>({})
  const { failure, busy, save } = useRuleSave(onDone)
  const ranks = ranksOf(scope.version.rules, ladder)
  const eligibleOptions = ladders.flatMap((l) => ranksOf(scope.version.rules, l.rule_key).map((rank) => ({ value: `${l.rule_key}|${rank}`, label: `${l.rule_key} ≥ ${rank}` })))
  const valueOf = (rank: string) => rows.find((r) => r.rank === rank)?.value ?? ''
  const setValue = (rank: string, value: string) => setRows([...rows.filter((r) => r.rank !== rank), { rank, value }])
  function submit() {
    const found: Issues = {}
    const add = (id: string, message: string | null) => {
      if (message !== null) found[id] = message
    }
    add('pool-key', ruleKeyIssue(key, scope.version.rules, pool === null))
    add('pool-measure', baseMeasure === '' ? 'Choose the measure the pool is a share of.' : null)
    add('pool-rate', decimalIssue(rate, 'the rate'))
    add('pool-reversal', reversal === '' ? 'Choose how refunds reverse the pool.' : null)
    const filled = ranks.flatMap((rank) => (valueOf(rank).trim() === '' ? [] : [{ rank, value: valueOf(rank).trim() }]))
    if (type === 'first_n') {
      add('pool-n', /^[1-9]\d*$/.test(n) ? null : 'Enter how many payees share the pool.')
      add('pool-order', orderBy === '' ? 'Choose the measure that orders the payees.' : null)
    } else {
      add('pool-ladder', ladder === '' ? 'Add a rank ladder first.' : null)
      add('pool-allocation', filled.length === 0 ? 'Enter a value for at least one rank.' : null)
      if (filled.some((r) => (type === 'shares' ? !/^[1-9]\d*$/.test(r.value) : !DECIMAL.test(r.value)))) found['pool-allocation'] = type === 'shares' ? 'Shares are whole numbers from 1.' : 'Parts are decimals such as 0.25.'
    }
    setIssues(found)
    if (Object.keys(found).length > 0) return
    const allocation = type === 'first_n' ? { type, n: Number(n), orderBy }
      : type === 'shares' ? { type, ladder, shares: filled.map((r) => ({ rank: r.rank, shares: Number(r.value) })) }
        : { type, ladder, parts: filled.map((r) => ({ rank: r.rank, share: r.value })) }
    const [eligibleLadder, eligibleRank] = eligible.split('|')
    const params = { sourceKind: 'pool', eligibleIf: eligible === '' ? null : { ladder: eligibleLadder, rank: eligibleRank }, baseMeasure, rate, allocation }
    void save({ scope, key, kind: 'pay.pool', params, ordinal: pool?.ordinal ?? 0, reversal, calendar: pool?.calendar_id ?? '' })
  }
  return (
    <FormCard icon="pie_chart" title={pool === null ? 'New pool' : `Pool ${pool.rule_key}`} note="A share of a market total, divided among qualifying payees."
      issues={issues} failure={failure} busy={busy} onCancel={onDone} onSubmit={submit} submitLabel="Save pool">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
        <TextInput id="pool-key" label="Pool key" value={key} readOnly={pool !== null} error={issues['pool-key']} onChange={(event) => setKey(event.target.value)} />
        <Select id="pool-measure" label="Base measure" value={baseMeasure} placeholder="Choose a measure" error={issues['pool-measure']} options={options(measures)} onChange={(event) => setBaseMeasure(event.target.value)} />
        <TextInput id="pool-rate" label="Rate" inputMode="decimal" value={rate} error={issues['pool-rate']} helper="Share of the market total, such as 0.02." onChange={(event) => setRate(event.target.value)} />
      </div>
      <RadioGroup legend="Allocation" name="pool-allocation-type" value={type} onChange={setType} options={[
        { value: 'shares', label: 'Shares by rank', helper: 'Each payee gets the shares of the rank they are paid as.' },
        { value: 'rank_order', label: 'Part per rank', helper: 'Each rank gets a part of the pool, split equally among its payees.' },
        { value: 'first_n', label: 'First N payees', helper: 'The N eligible payees with the highest value of a measure share equally.' },
      ]} />
      {type === 'first_n'
        ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
            <TextInput id="pool-n" label="Number of payees" inputMode="numeric" value={n} error={issues['pool-n']} onChange={(event) => setN(event.target.value)} />
            <Select id="pool-order" label="Ordered by" value={orderBy} placeholder="Choose a measure" error={issues['pool-order']} options={options(measures)} onChange={(event) => setOrderBy(event.target.value)} />
          </div>
        )
        : (
          <fieldset id="pool-allocation" tabIndex={-1} className={FIELDSET} aria-describedby={issues['pool-allocation'] === undefined ? undefined : 'pool-allocation-error'}>
            <legend className={LEGEND}>{type === 'shares' ? 'Shares per rank' : 'Part of the pool per rank'}</legend>
            <Select id="pool-ladder" label="Ladder" value={ladder} placeholder="Choose a ladder" error={issues['pool-ladder']} options={options(ladders)} onChange={(event) => setLadder(event.target.value)} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
              {ranks.map((rank) => <TextInput key={rank} label={`${type === 'shares' ? 'Shares' : 'Part'} for ${rank}`} optional inputMode="decimal" value={valueOf(rank)} onChange={(event) => setValue(rank, event.target.value)} />)}
            </div>
            {issues['pool-allocation'] !== undefined && <p id="pool-allocation-error" className="font-caption text-caption text-error">{issues['pool-allocation']}</p>}
          </fieldset>
        )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
        <Select label="Paid to" value={eligible} options={[{ value: '', label: 'Every earner' }, ...eligibleOptions]} onChange={(event) => setEligible(event.target.value)} />
        <Select id="pool-reversal" label="Reversal policy" value={reversal} placeholder="Choose how refunds reverse it" error={issues['pool-reversal']}
          options={Object.entries(REVERSAL_LABELS).map(([value, label]) => ({ value, label }))} onChange={(event) => setReversal(event.target.value)} />
      </div>
    </FormCard>
  )
}

