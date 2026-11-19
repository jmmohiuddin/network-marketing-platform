'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { blockerText, FIELD_LABELS, privacyItemLabel, TYPE_LABELS } from '../privacy/format'
import type { ErasureBlocker, PrivacyPayload, PrivacyPreview } from '../privacy/types'
import { marketMoney, reviewPath } from '../periods/format'
import { CheckLine } from './effect-preview'
import { Facts, useCaseMarket } from './money-effects'
import { ParticipantLink, PeriodLink, PositionLink } from './refs'
import type { CaseRecord } from './types'

// SC-06 parts of the B5 case types: commission disputes (D-B5-15) and privacy requests (D-B5-16..19).

const MONO = 'font-data-mono-sm text-data-mono-sm'
const LINK = 'text-primary font-semibold hover:underline'
const LIST_TITLE = 'font-caption text-caption uppercase text-secondary font-semibold'

/** effect_preview of a dispute (comp/disputes.ts): the disputed line, its position and period. */
export interface DisputePreview {
  readonly line: { readonly id: string; readonly amount_minor: string; readonly currency: string; readonly rule_key: string }
  readonly position: { readonly id: string; readonly position_ref: string }
  readonly run_id: string
  readonly period: { readonly id: string; readonly starts_at: string; readonly ends_at: string }
}

/** The dispute payload (message and the line's stored trace, which is never dumped on the page). */
export interface DisputePayload {
  readonly line_id: string
  readonly run_id: string
  readonly participant_id: string
  readonly message: string
}

/** SC-02 run review with the line's trace drawer open (?tab=lines&line=). */
export const tracePath = (preview: DisputePreview): string => `${reviewPath(preview.period.id, preview.run_id)}?tab=lines&line=${preview.line.id}`

/** Line facts of a dispute: bonus, amount, position, period and the link to its calculation trace (trace.read). */
export function DisputeEffect({ record }: { readonly record: CaseRecord }) {
  const { can } = useSession()
  const market = useCaseMarket(record)
  const preview = record.effect_preview as DisputePreview
  return (
    <div className="flex flex-col gap-space-sm">
      <Facts items={[
        ['Bonus', <span key="rule" className={MONO}>{preview.line.rule_key}</span>],
        ['Line amount', <span key="amount" className={`${MONO} font-semibold`}>{market === undefined ? `${preview.line.amount_minor} ${preview.line.currency} minor units` : marketMoney(preview.line.amount_minor, market)}</span>],
        ['Position', <PositionLink key="position" id={preview.position.id} withOwner={false} />],
        ['Period', <PeriodLink key="period" id={preview.period.id} />],
      ]} />
      {can('trace.read')
        ? <Link className={`${LINK} self-start`} href={tracePath(preview)}>Open the calculation trace of this line</Link>
        : <p className="font-caption text-caption text-secondary">The line’s calculation trace is attached to the case; reading it needs trace access.</p>}
    </div>
  )
}

/** The privacy case's proposal: the request, the retention basis and the corrected fields (names only). */
export function privacyFacts(record: CaseRecord): readonly (readonly [string, ReactNode])[] {
  const payload = record.payload as PrivacyPayload
  return [
    ['Request', <Link key="request" className={LINK} href={`/privacy/${payload.request_id}`}>Open the privacy request</Link>],
    ['Retention basis', payload.retention_basis ?? 'Not stated yet'],
    ...(payload.corrections === undefined ? [] : [['Corrected fields', payload.corrections.map((field) => FIELD_LABELS[field] ?? field).join(', ')] as const]),
  ]
}

/** Export sections, or what erasure clears / keeps, in words (BUG-116). */
function NameList({ title, names }: { readonly title: string; readonly names: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <h3 className={LIST_TITLE}>{title}</h3>
      <ul className="flex flex-col gap-0.5">
        {names.map((name) => <li key={name} className="font-body-sm text-body-sm text-on-surface break-words">{privacyItemLabel(name)}</li>)}
      </ul>
    </div>
  )
}

/** What erasure would wait for, or that nothing does. */
export function BlockerLines({ blockers, markets }: { readonly blockers: readonly ErasureBlocker[] | null | undefined; readonly markets: readonly Market[] | undefined }) {
  if (blockers === undefined || blockers === null || blockers.length === 0) return <CheckLine ok>Nothing defers the erasure now.</CheckLine>
  return (
    <ul className="flex flex-col gap-0.5" aria-label="What defers the erasure">
      {blockers.map((blocker) => <li key={JSON.stringify(blocker)}><CheckLine ok={false}>{blockerText(blocker, markets)}</CheckLine></li>)}
    </ul>
  )
}

/** The privacy preview stored at submit: erasure (cleared vs retained, blockers), correction (masked values) or the export's sections. */
export function PrivacyEffect({ record }: { readonly record: CaseRecord }) {
  const preview = record.effect_preview as PrivacyPreview
  const markets = useResource<Market[]>(preview.type === 'erasure' ? MARKETS_PATH : null)
  return (
    <div className="flex flex-col gap-space-sm">
      <Facts items={[['Request type', TYPE_LABELS[preview.type]], ['Member', <ParticipantLink key="subject" id={preview.subject.id} />]]} />
      {preview.type === 'erasure' && (
        <>
          <BlockerLines blockers={preview.blockers} markets={markets.data ?? undefined} />
          <p className="font-caption text-caption text-secondary">Blockers are checked again when the case is approved.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md" data-testid="erasure-preview">
            <NameList title="Cleared" names={preview.cleared ?? []} />
            <NameList title="Retained (kept without the name)" names={preview.retained ?? []} />
          </div>
        </>
      )}
      {preview.corrections !== undefined && (
        <Facts items={preview.corrections.map((change) => [FIELD_LABELS[change.field] ?? change.field, <span key={change.field} className={MONO}>{change.current ?? 'Not recorded'} → {change.corrected ?? 'Not recorded'}</span>] as const)} />
      )}
      {preview.sections !== undefined && <NameList title="The export holds" names={preview.sections} />}
    </div>
  )
}
