'use client'

import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { Drawer } from '../../components/drawer'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { FieldError, FormField, Select, TextInput, TEXTAREA_CLASS } from '../../components/form-field'
import { Icon } from '../../components/icon'
import { ConfirmDialog } from '../../components/modal'
import { useToast } from '../../components/toast'
import { ApiError, isApiError } from '../../lib/api'
import { countLabel } from '../../lib/format'
import { errorMessage, fieldErrors } from '../../lib/messages'
import { CODE_BLOCK } from '../admin/ui'
import { isBonus, kindLabel, passBadge, PASSES, REVERSAL_LABELS, RULE_KINDS, versionApi, versionPage } from './format'
import type { PlanSummary, Rule, VersionView } from './types'
import { CAPTION, CARD, H2, ifMatch, MONO, NOTE, RefusalBanner, reloadedIfStale } from './ui'

const RULE_KEY = /^[a-z][a-z0-9_]{0,63}$/
/** Caps and pools are edited with their own forms on SC-05. */
const STRUCTURED_KINDS = new Set(['cap', 'pay.pool'])
const ORDINAL_LIMIT = 1000

export interface DraftScope {
  readonly plan: PlanSummary
  readonly version: VersionView
  /** draft, plan.edit, not a support session. */
  readonly canEdit: boolean
  readonly reload: () => void
}

const capsPage = (scope: DraftScope) => `${versionPage(scope.plan.id, scope.version.version)}/caps`

interface RuleForm {
  readonly key: string
  readonly kind: string
  readonly params: string
  readonly reversal: string
  readonly calendar: string
  readonly ordinal: string
}

const formOf = (rule: Rule | null): RuleForm => ({
  key: rule?.rule_key ?? '',
  kind: rule?.kind ?? '',
  params: JSON.stringify(rule?.params ?? {}, null, 2),
  reversal: rule?.reversal_policy ?? '',
  calendar: rule?.calendar_id ?? '',
  ordinal: String(rule?.ordinal ?? 0),
})

/** The key of a rule, cap or pool: the pattern, and on create a key no rule of the draft has (PUT …/rules/:key replaces that rule). */
export function ruleKeyIssue(key: string, rules: readonly Rule[], creating: boolean): string | null {
  if (!RULE_KEY.test(key)) return 'Use 1 to 64 lower-case letters, digits or underscores, starting with a letter.'
  return creating && rules.some((r) => r.rule_key === key) ? `A rule named ${key} already exists; edit it instead.` : null
}

/** Client checks before PUT …/rules/:ruleKey; the engine validates the parameters on the server. */
function ruleFormIssues(form: RuleForm, rules: readonly Rule[], creating: boolean): { issues: Record<string, string>; params: unknown } {
  const issues: Record<string, string> = {}
  const keyIssue = ruleKeyIssue(form.key, rules, creating)
  if (keyIssue !== null) issues.key = keyIssue
  if (form.kind === '') issues.kind = 'Choose the rule kind.'
  const ordinal = Number(form.ordinal)
  if (!Number.isInteger(ordinal) || Math.abs(ordinal) > ORDINAL_LIMIT) issues.ordinal = `Enter a whole number from -${ORDINAL_LIMIT} to ${ORDINAL_LIMIT}.`
  let params: unknown = null
  try {
    params = JSON.parse(form.params)
    if (typeof params !== 'object' || params === null || Array.isArray(params)) issues.params = 'The parameters are one JSON object: { … }.'
  } catch {
    issues.params = 'The parameters are not valid JSON.'
  }
  return { issues, params }
}

/** RULE_INVALID details as "path: message" lines (per-path server errors). */
const ruleIssues = (error: unknown): readonly { path: string; message: string }[] =>
  error instanceof ApiError && error.code === 'RULE_INVALID' ? ((error.details as { errors?: { path: string; message: string }[] } | null)?.errors ?? []) : []

/**
 * The rule editor drawer: key, kind, parameters, reversal policy, calendar, ordinal; saved by PUT with If-Match.
 * shortcut: JSON params textarea with per-path server errors for kinds other than caps and pools; structured forms per kind when plan admins ask.
 */
function RuleDrawer({ scope, rule, onClose }: { readonly scope: DraftScope; readonly rule: Rule | null; readonly onClose: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [form, setForm] = useState<RuleForm>(() => formOf(rule))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const set = (field: keyof RuleForm) => (value: string) => setForm({ ...form, [field]: value })
  const kinds = RULE_KINDS.filter((kind) => !STRUCTURED_KINDS.has(kind) || kind === rule?.kind)
  async function save(event: FormEvent) {
    event.preventDefault()
    const checked = ruleFormIssues(form, scope.version.rules, rule === null)
    setIssues(checked.issues)
    setFailure(null)
    if (Object.keys(checked.issues).length > 0) return
    setBusy(true)
    try {
      const body = {
        kind: form.kind, params: checked.params, ordinal: Number(form.ordinal),
        reversal_policy: isBonus(form.kind) && form.reversal !== '' ? form.reversal : null,
        calendar_id: form.calendar === '' ? null : form.calendar,
      }
      const { data } = await api.put<{ guardrails: { new_decisions: readonly unknown[] } }>(`${versionApi(scope.plan.id, scope.version.version)}/rules/${form.key}`, body, { headers: ifMatch(scope.version) })
      const decisions = data.guardrails.new_decisions.length
      toast({ message: decisions === 0 ? `Rule ${form.key} saved.` : `Rule ${form.key} saved. ${countLabel(decisions, 'new guardrail decision')}: see the Guardrails tab.`, tone: decisions === 0 ? 'success' : 'info' })
      onClose()
      scope.reload()
    } catch (error) {
      setIssues(fieldErrors(error))
      setFailure(reloadedIfStale(error, scope.reload))
      setBusy(false)
    }
  }
  const pathIssues = ruleIssues(failure)
  const summary: SummaryItem[] = Object.entries(issues).map(([field, message]) => ({ fieldId: `rule-${field}`, message }))
  const structured = STRUCTURED_KINDS.has(form.kind)
  return (
    <Drawer open onClose={busy ? () => undefined : onClose} title={rule === null ? 'Add rule' : `Edit rule ${rule.rule_key}`} description={rule === null ? undefined : kindLabel(rule.kind)} icon="rule" width="lg">
      <form className="flex flex-col gap-space-md" onSubmit={save} noValidate>
        <ErrorSummary items={summary} />
        {failure !== null && pathIssues.length === 0 && <RefusalBanner error={failure} title={isApiError(failure, 'GUARDRAIL_BLOCKED') ? 'The rule was not saved' : undefined} />}
        <TextInput id="rule-key" label="Rule key" value={form.key} readOnly={rule !== null} error={issues.key} helper="Lower-case letters, digits and underscores; other rules refer to it." onChange={(event) => set('key')(event.target.value)} />
        <Select id="rule-kind" label="Kind" value={form.kind} placeholder="Choose a kind" error={issues.kind} options={kinds.map((kind) => ({ value: kind, label: kindLabel(kind) }))} onChange={(event) => set('kind')(event.target.value)} />
        {structured
          ? <Banner tone="info" action={<LinkButton href={capsPage(scope)} icon="tune">Open caps and pools</LinkButton>}>Caps and pools have their own form with scope, method and priority order.</Banner>
          : (
            <FormField id="rule-params" label="Parameters (JSON)" error={issues.params} helper="The engine's parameters for this kind, without key and kind. Amounts are minor units in strings.">
              {(control) => (
                <textarea {...control} className={`${TEXTAREA_CLASS} min-h-60 font-data-mono-sm text-data-mono-sm`} spellCheck={false} value={form.params} onChange={(event) => set('params')(event.target.value)} />
              )}
            </FormField>
          )}
        {pathIssues.length > 0 && (
          <div role="alert" className="flex flex-col gap-space-xxs">
            <p className="font-body-sm text-body-sm text-on-surface font-semibold">{errorMessage(failure)}</p>
            {pathIssues.map((issue) => <FieldError key={`${issue.path}-${issue.message}`} message={issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`} />)}
          </div>
        )}
        {isBonus(form.kind) && (
          <Select id="rule-reversal" label="Reversal policy" value={form.reversal} placeholder="Choose how refunds reverse it"
            options={Object.entries(REVERSAL_LABELS).map(([value, label]) => ({ value, label }))} onChange={(event) => set('reversal')(event.target.value)} />
        )}
        <Select id="rule-calendar" label="Calendar" value={form.calendar} helper="A rule scoped to one calendar runs only in that calendar's runs."
          options={[{ value: '', label: 'Every plan calendar' }, ...scope.plan.calendars.map((c) => ({ value: c.id, label: `${c.name} (${c.market_code})` }))]} onChange={(event) => set('calendar')(event.target.value)} />
        <TextInput id="rule-ordinal" label="Ordinal" inputMode="numeric" value={form.ordinal} error={issues.ordinal} helper="Order among rules of the same pass; overlapping caps need different ordinals." onChange={(event) => set('ordinal')(event.target.value)} />
        <div className="flex flex-wrap justify-end gap-space-sm pt-space-sm border-t border-surface-container">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          {!structured && <Button type="submit" variant="primary" icon="save" loading={busy}>Save rule</Button>}
        </div>
      </form>
    </Drawer>
  )
}

function RuleItem({ rule, scope, errors, onEdit, onDelete }: { readonly rule: Rule; readonly scope: DraftScope; readonly errors: readonly string[]; readonly onEdit: () => void; readonly onDelete: () => void }) {
  const calendar = scope.plan.calendars.find((c) => c.id === rule.calendar_id)
  const structured = STRUCTURED_KINDS.has(rule.kind)
  return (
    <li className="p-space-sm rounded bg-surface-container-low flex flex-col gap-space-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className={`${MONO} font-bold text-primary`}>{rule.rule_key}</span>
          <span className="font-body-sm text-body-sm font-semibold text-on-surface">{kindLabel(rule.kind)}</span>
          {rule.extension && <span className="px-2 py-0.5 rounded bg-primary-fixed text-primary text-[11px] font-semibold">Extension</span>}
          {calendar !== undefined && <span className="px-2 py-0.5 rounded bg-surface-container text-secondary text-[11px] font-semibold">{calendar.name}</span>}
        </div>
        {scope.canEdit && (
          <div className="flex items-center gap-space-xs">
            {structured
              ? <LinkButton size="sm" href={capsPage(scope)} aria-label={`Edit ${rule.rule_key} on the caps and pools page`}>Edit</LinkButton>
              : <Button size="sm" icon="edit" aria-label={`Edit rule ${rule.rule_key}`} onClick={onEdit}>Edit</Button>}
            <Button size="sm" variant="destructive" icon="delete" aria-label={`Delete rule ${rule.rule_key}`} onClick={onDelete}>Delete</Button>
          </div>
        )}
      </div>
      <div className="p-space-xs px-space-sm bg-surface-container rounded font-body-sm text-body-sm flex items-start gap-2">
        <Icon name="translate" size={16} className="text-primary mt-0.5" />
        <p className="text-on-surface"><span className="font-semibold">In plain language:</span> {rule.rendering}</p>
      </div>
      {errors.map((message) => <FieldError key={message} message={message} />)}
      {!scope.canEdit && (
        <details>
          <summary className="cursor-pointer font-caption text-caption text-primary font-semibold">Parameters of {rule.rule_key}</summary>
          <pre className={`${CODE_BLOCK} mt-space-xs`}>{JSON.stringify(rule.params, null, 2)}</pre>
        </details>
      )}
    </li>
  )
}

/** SC-04 Rules tab: rules grouped by engine pass with their plain-language rendering and validation errors. */
export function RulesTab({ scope }: { readonly scope: DraftScope }) {
  const api = useApi()
  const toast = useToast()
  const [editing, setEditing] = useState<Rule | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Rule | null>(null)
  const { version } = scope
  const errorsOf = (key: string | null) => version.validation.errors.filter((e) => e.rule_key === key).map((e) => (e.path === '' ? e.message : `${e.path}: ${e.message}`))
  const planErrors = errorsOf(null)
  async function remove(rule: Rule) {
    try {
      await api.delete(`${versionApi(scope.plan.id, version.version)}/rules/${rule.rule_key}`, { headers: ifMatch(version) })
    } catch (error) {
      throw reloadedIfStale(error, scope.reload)
    }
    toast({ message: `Rule ${rule.rule_key} deleted.` })
    setDeleting(null)
    scope.reload()
  }
  return (
    <div className="flex flex-col gap-space-md">
      <div className={`${CARD} sm:flex-row sm:items-center sm:justify-between`}>
        <p className={NOTE}>{countLabel(version.rules.length, 'rule')} · {version.validation.ok ? 'no validation errors' : countLabel(version.validation.errors.length, 'validation error')}</p>
        {scope.canEdit && <Button icon="add" onClick={() => setEditing('new')}>Add rule</Button>}
      </div>
      {planErrors.length > 0 && <Banner tone="danger" title="The plan does not validate"><ul className="list-disc pl-space-md">{planErrors.map((m) => <li key={m}>{m}</li>)}</ul></Banner>}
      {version.rules.length === 0 && <p className={`${CARD} ${NOTE}`}>No rules yet.{scope.canEdit ? ' Add the measures first, then ranks and bonuses.' : ''}</p>}
      {PASSES.map(({ pass, title }) => {
        const rules = version.rules.filter((r) => r.pass === pass).sort((a, b) => a.ordinal - b.ordinal || a.rule_key.localeCompare(b.rule_key))
        if (rules.length === 0) return null
        const headingId = `pass-${pass}`
        return (
          <section key={pass} aria-labelledby={headingId} className={CARD}>
            <div className="flex items-center justify-between gap-space-sm">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded bg-surface-container text-secondary ${MONO} font-bold`}>{passBadge(pass)}</span>
                <h2 id={headingId} className={H2}>{title}</h2>
              </div>
              <span className={CAPTION}>{countLabel(rules.length, 'rule')}</span>
            </div>
            <ul className="flex flex-col gap-space-sm">
              {rules.map((rule) => <RuleItem key={rule.rule_key} rule={rule} scope={scope} errors={errorsOf(rule.rule_key)} onEdit={() => setEditing(rule)} onDelete={() => setDeleting(rule)} />)}
            </ul>
          </section>
        )
      })}
      {editing !== null && <RuleDrawer scope={scope} rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete rule ${deleting?.rule_key ?? ''}`}
        consequence="The rule is removed from this draft; rules that refer to it show a validation error until you change them."
        confirmLabel="Delete rule"
        destructive
        onConfirm={() => remove(deleting!)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

