'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Icon } from '../../components/icon'
import { ApiError } from '../../lib/api'
import type { Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useResource, type Query, type Resource } from '../../lib/use-resource'
import { MARKETS_PATH } from '../../lib/markets'
import { withApprovers } from '../admin/settings/labels'
import { BASIS_STATUS } from '../markets/format'
import type { BasisStatus } from '../markets/types'
import { PLANS_PATH, versionApi } from './format'
import type { PeriodsView, PlanDetail, VersionView } from './types'

// Stitch blocks shared by SC-04, SC-05 and SC-42 (sc_04 cards, sc_42 KPI cards, sc_05 form panels).
export const CARD = 'bg-surface-container-lowest rounded-lg shadow-sm p-space-md flex flex-col gap-space-sm'
export const NOTE = 'font-body-sm text-body-sm text-secondary'
export const MONO = 'font-data-mono-sm text-data-mono-sm'
export const CAPTION = 'font-caption text-caption text-secondary uppercase tracking-wider font-semibold'
export const H2 = 'font-section-heading text-section-heading text-on-surface'

/** sc_42 card head: icon, h2 and a one-line note, an aside on the right. */
export function CardHead({ icon, title, note, aside, id }: { readonly icon: string; readonly title: string; readonly note?: ReactNode; readonly aside?: ReactNode; readonly id?: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
      <div className="flex items-center gap-space-sm min-w-0">
        <Icon name={icon} size={20} className="text-primary" />
        <div className="min-w-0">
          <h2 id={id} className={H2}>{title}</h2>
          {note !== undefined && <p className="font-caption text-caption text-secondary">{note}</p>}
        </div>
      </div>
      {aside !== undefined && <div className="flex flex-wrap items-center gap-space-xs">{aside}</div>}
    </div>
  )
}

export interface PlanData {
  readonly plan: Resource<PlanDetail>
  readonly version: Resource<VersionView>
  readonly markets: Resource<readonly Market[]>
}

/** The last answer stays shown while a reload runs, so a page keeps its open forms and messages after a save. */
function useKeptData<T>(resource: Resource<T>): Resource<T> {
  const [kept, setKept] = useState<T | null>(null)
  if (resource.data !== null && resource.data !== kept) setKept(resource.data)
  return resource.data !== null || resource.error !== null ? resource : { ...resource, data: kept }
}

/** The plan, one version and the markets money text needs (a plan calendar's currency is its market's). */
export function usePlanData(planId: string, version: number): PlanData {
  const plan = useKeptData(useResource<PlanDetail>(`${PLANS_PATH}/${planId}`))
  const view = useKeptData(useResource<VersionView>(versionApi(planId, version)))
  const markets = useResource<readonly Market[]>(MARKETS_PATH)
  return { plan, version: view, markets }
}

interface PeriodsAnswer { readonly key: string; readonly data: PeriodsView | null; readonly error: unknown }

/**
 * GET /v1/periods?calendar_id=<id>&… once per plan calendar (period.read), as one view: the calendars in scope and the
 * periods of these calendars, newest first. Calendars and query are compared by value, so a new array or object loads nothing again.
 */
export function useCalendarPeriods(calendarIds: readonly string[], query: Query): Resource<PeriodsView> {
  const api = useApi()
  const key = JSON.stringify([calendarIds, query])
  const [answer, setAnswer] = useState<PeriodsAnswer | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(calendarIds.map((id) => api.get<PeriodsView>('/v1/periods', { query: { ...query, calendar_id: id }, signal: controller.signal }))).then(
      (pages) => setAnswer({
        key,
        data: { calendars: pages[0]?.data.calendars ?? [], periods: pages.flatMap((p) => p.data.periods).sort((a, b) => b.starts_at.localeCompare(a.starts_at)) },
        error: null,
      }),
      (error: unknown) => {
        if (!controller.signal.aborted) setAnswer({ key, data: null, error })
      },
    )
    return () => controller.abort()
  }, [api, key, round]) // key stands for calendarIds and query
  const current = answer?.key === key ? answer : null
  return {
    data: current?.data ?? null, meta: {}, error: current?.error ?? null, loading: current === null,
    reload: () => {
      setAnswer(null)
      setRound((value) => value + 1)
    },
  }
}

const listOf = (details: unknown, field: string): unknown[] => {
  const value = (details as Record<string, unknown> | null)?.[field]
  return Array.isArray(value) ? value : []
}

/** Names of objects a refusal points at (calendars, markets). */
export interface RefusalNames {
  readonly calendar?: (id: string) => string
  readonly market?: (id: string) => string
}

/** guardrail_outstanding reasons in words (BUG-092). */
const OUTSTANDING_REASONS: Readonly<Record<string, string>> = {
  acknowledgement_required: 'the warning needs an acknowledgement (Guardrails tab) or a compliance override.',
  override_required: 'the block needs a compliance override.',
  not_overridable: 'the block cannot be overridden: change the rules it matched.',
}

/** The details of a lifecycle or rule refusal as sentences (the message says what failed; these say where). */
export function refusalLines(error: unknown, names: RefusalNames = {}): string[] {
  if (!(error instanceof ApiError)) return []
  const d = (error.details ?? {}) as Record<string, unknown>
  switch (error.code) {
    case 'PLAN_INVALID':
      return listOf(d, 'errors').map((e) => {
        const issue = e as { rule_key: string | null; message: string }
        return `${issue.rule_key ?? 'Plan'}: ${issue.message}`
      })
    case 'EXTENSION_NOT_COVERED':
      return listOf(d, 'rule_keys').map((key) => `${String(key)} has no golden case.`)
    case 'GUARDRAIL_OUTSTANDING':
      return listOf(d, 'decisions').map((x) => {
        const o = x as { rule_id: string; reason: string }
        return `${o.rule_id}: ${OUTSTANDING_REASONS[o.reason] ?? o.reason}`
      })
    case 'GOLDEN_FAILED':
      return listOf(d, 'datasets').map((x) => {
        const g = x as { name: string; mismatches: unknown[]; error: { message: string } | null }
        return g.error !== null ? `${g.name}: ${g.error.message}` : `${g.name}: ${g.mismatches.length} line${g.mismatches.length === 1 ? '' : 's'} differ.`
      })
    case 'TRANSITION_MISSING':
      return listOf(d, 'state_items').map((item) => `No transition declared for ${String(item)}.`)
    case 'UNKNOWN_EXTENSION_RULE':
      return listOf(d, 'rule_keys').map((key) => `${String(key)} is not an extension rule of this version.`)
    case 'EFFECTIVE_NOT_AT_BOUNDARY': {
      const id = String(d.calendar_id ?? '')
      return [`No period of ${names.calendar?.(id) ?? 'a plan calendar'} starts at that time.`]
    }
    case 'CREDITING_EVENT_CONFLICT': {
      const market = names.market?.(String(d.market_id ?? '')) ?? 'a plan market'
      return [d.reason === 'ingested_orders'
        ? `Orders of ${market} placed since that time were already credited on another event.`
        : `Another plan covering ${market} credits orders on another event at that time.`]
    }
    case 'GUARDRAIL_BLOCKED': {
      const status = BASIS_STATUS[d.basis_status as BasisStatus]?.label ?? String(d.basis_status ?? '')
      return [`${String(d.rule_id)} — ${String(d.title)}: ${String(d.explanation)}`, `Basis status: ${status}.`]
    }
    case 'RULE_INVALID':
      return listOf(d, 'errors').map((e) => {
        const issue = e as { path: string; message: string }
        return issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`
      })
    default:
      return []
  }
}

/** The refusal with its details in the message, for a dialog's error summary (role: who decides on a SoD refusal). */
export function explainedError(error: unknown, names: RefusalNames = {}, role?: string): unknown {
  const shown = role === undefined ? error : withApprovers(error, role)
  const lines = refusalLines(error, names)
  if (!(shown instanceof ApiError) || lines.length === 0) return shown
  return new ApiError(shown.status, shown.code, [shown.message, ...lines].join(' '), shown.details, shown.requestId)
}

/** If-Match of a draft write: the revision the page shows (GET version answers ETag "<revision>"). */
export const ifMatch = (version: Pick<VersionView, 'revision'>): Readonly<Record<string, string>> => ({ 'If-Match': `"${version.revision}"` })

const STALE = 'Someone changed this version since you loaded it. It has been loaded again: check it and try again.'

/** 412 PRECONDITION_FAILED: loads the version again and says so; any other error unchanged. */
export function reloadedIfStale(error: unknown, reload: () => void): unknown {
  if (!(error instanceof ApiError) || error.status !== 412) return error
  reload()
  return new ApiError(412, error.code, STALE, error.details, error.requestId)
}

/** A refused action: the server's sentence, then where it failed. role names who decides on a SoD refusal. */
export function RefusalBanner({ error, names, role, title }: { readonly error: unknown; readonly names?: RefusalNames; readonly role?: string; readonly title?: string }) {
  const shown = role === undefined ? error : withApprovers(error, role)
  const lines = refusalLines(error, names)
  return (
    <Banner tone="danger" title={title}>
      <p>{errorMessage(shown)}</p>
      {lines.length > 0 && <ul className="list-disc pl-space-md mt-1 flex flex-col gap-space-xxs">{lines.map((line) => <li key={line}>{line}</li>)}</ul>}
    </Banner>
  )
}
