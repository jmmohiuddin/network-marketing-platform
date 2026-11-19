'use client'

import { Icon } from '../../components/icon'
import { StatusBadge } from '../../components/status-badge'
import { periodText } from '../periods/format'
import { isLive, OUTCOME_LABELS, structuralText } from './format'
import { MONEY_CASE_TYPES, MoneyEffect } from './money-effects'
import { PositionLink } from './refs'
import { RestatementEffect, type RestatementPreview } from './restatement-effect'
import type { CaseRecord, DuplicatePreview, RelationshipPreview, TransferPreview } from './types'

const LABEL = 'font-caption text-caption uppercase text-secondary font-semibold'
const BOX = 'flex-1 flex flex-col p-space-xs rounded bg-surface-container-lowest border border-outline-variant min-w-0'
const MONO = 'font-data-mono-sm text-data-mono-sm'

/** sc_08 transfer path: current -> proposed. */
export function PathVector({ from, to, fromLabel, toLabel }: { readonly from: string; readonly to: string; readonly fromLabel: string; readonly toLabel: string }) {
  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-space-sm p-space-sm bg-surface rounded border border-outline-variant">
      <div className={BOX}>
        <span className="font-caption text-caption text-secondary uppercase">{fromLabel}</span>
        <span className={`${MONO} mt-1 text-on-surface`}>{from}</span>
      </div>
      <Icon name="trending_flat" size={24} className="text-primary self-center rotate-90 md:rotate-0" />
      <div className={`${BOX} border-primary/40`}>
        <span className="font-caption text-caption text-primary uppercase font-semibold">{toLabel}</span>
        <span className={`${MONO} mt-1 text-on-surface`}>{to}</span>
      </div>
    </div>
  )
}

export function CheckLine({ ok, children }: { readonly ok: boolean; readonly children: string }) {
  return (
    <p className={`flex items-start gap-space-xs font-body-sm text-body-sm ${ok ? 'text-tertiary' : 'text-error font-semibold'}`}>
      <Icon name={ok ? 'check_circle' : 'error'} size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function RelationshipEffect({ preview, live }: { readonly preview: RelationshipPreview; readonly live: boolean }) {
  const current = preview.current_parent === null ? 'No parent (a root)' : `${preview.current_parent.position_ref}${preview.current_parent.leg === null ? '' : ` · leg ${preview.current_parent.leg}`}`
  const periods = preview.affected_committed_periods
  return (
    <div className="flex flex-col gap-space-sm">
      <PathVector fromLabel={live ? 'Current parent' : 'Parent when submitted'} from={current} toLabel="Proposed parent" to={preview.proposed_parent?.position_ref ?? '—'} />
      <CheckLine ok={preview.structural_check.ok}>{preview.structural_check.ok ? 'Structural check passed: no cycle, no overlap, the leg is free.' : structuralText(preview.structural_check.code)}</CheckLine>
      {periods.length === 0 ? (
        <CheckLine ok>No committed period affected.</CheckLine>
      ) : (
        <div className="p-space-sm bg-[#FFF4D6]/50 rounded border border-[#F5D580] flex items-start gap-space-sm" data-testid="committed-periods">
          <Icon name="warning" size={20} className="text-[#7A4900] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-body-sm text-body-sm font-semibold text-[#7A4900]">Committed periods affected: {periods.length}</span>
            <p className="font-caption text-caption text-on-surface-variant">Committed periods are never edited; the difference is handled in an open period.</p>
            <ul className="flex flex-col gap-0.5">
              {periods.map((period) => (
                <li key={period.period_id} className={`${MONO} text-on-surface`}>{periodText(period, undefined)} · {period.state}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {preview.impact_note !== undefined && <p className="font-caption text-caption text-secondary">{preview.impact_note}</p>}
    </div>
  )
}

function TransferEffect({ preview, live }: { readonly preview: TransferPreview; readonly live: boolean }) {
  return (
    <div className="flex flex-col gap-space-sm">
      <PathVector fromLabel={live ? 'Current owner' : 'Owner when submitted'} from={preview.from_owner?.external_ref ?? 'No owner'} toLabel="New owner" to={preview.to_owner?.external_ref ?? '—'} />
      <CheckLine ok={preview.to_type_can_hold_positions}>
        {preview.to_type_can_hold_positions ? "The new owner's type can hold positions." : "The new owner's type cannot hold positions: approval will be refused."}
      </CheckLine>
    </div>
  )
}

function DuplicateEffect({ preview, live }: { readonly preview: DuplicatePreview; readonly live: boolean }) {
  return (
    <div className="flex flex-col gap-space-sm">
      <p className="font-body-sm text-body-sm text-on-surface"><span className="font-semibold">Proposed outcome:</span> {OUTCOME_LABELS[preview.outcome]}</p>
      {preview.positions.length === 0 ? <p className="font-body-sm text-body-sm text-secondary">The subject owns no positions.</p> : (
        <ul className="flex flex-col gap-1" aria-label="Positions of the subject">
          {preview.positions.map((position) => (
            <li key={position.id} className="flex items-center justify-between gap-space-sm">
              <PositionLink id={position.id} withOwner={live} />
              <StatusBadge state={position.status} />
            </li>
          ))}
        </ul>
      )}
      {preview.hold_active && <CheckLine ok={false}>Activation is on hold until this review is decided.</CheckLine>}
    </div>
  )
}

/** The effect preview stored at submit (PLAN B2 2.4), drawn per case type; before submit it says when it appears. */
export function EffectPreview({ record }: { readonly record: CaseRecord }) {
  const preview = record.effect_preview
  // The preview is stored at submit: once the case is decided, "current" would no longer be true (BUG-080).
  const live = isLive(record)
  let body
  if (preview === null) {
    body = <p className="font-body-sm text-body-sm text-secondary">The effect preview is calculated when the case is submitted for a decision.</p>
  } else if (MONEY_CASE_TYPES.includes(record.type)) {
    body = <MoneyEffect record={record} live={live} />
  } else if (record.type === 'transfer') {
    body = <TransferEffect preview={preview as TransferPreview} live={live} />
  } else if (record.type === 'restatement') {
    body = <RestatementEffect record={record} preview={preview as RestatementPreview} />
  } else if (record.type === 'duplicate') {
    body = <DuplicateEffect preview={preview as DuplicatePreview} live={live} />
  } else {
    body = <RelationshipEffect preview={preview as RelationshipPreview} live={live} />
  }
  return (
    <section className="bg-surface-container-lowest rounded shadow-sm p-space-md flex flex-col gap-space-sm" aria-labelledby="effect-title">
      <h2 id="effect-title" className={LABEL}>Effect preview</h2>
      {body}
    </section>
  )
}
