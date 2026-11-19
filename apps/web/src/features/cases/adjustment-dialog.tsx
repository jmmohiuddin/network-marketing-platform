'use client'

import { useState } from 'react'
import { Select, TextInput } from '../../components/form-field'
import { Modal } from '../../components/modal'
import { ApiError, isApiError } from '../../lib/api'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useResource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { TextAreaField } from '../admin/form-dialog'
import { decimalToMinor } from '../ledger/format'
import { PERIOD_STATE_LABELS, periodName } from '../periods/format'
import type { PeriodList } from '../periods/types'
import { CaseForm, NOTE_MAX } from './case-form'
import { caseTypeInfo } from './format'
import { PositionPicker } from './pickers'
import type { TreeNode } from './types'

const PREFIX = 'adjustment'
const IDS = { position: `${PREFIX}-position`, period: `${PREFIX}-period`, amount: `${PREFIX}-amount`, note: `${PREFIX}-note` }
/** D-B4-09: a manual adjustment goes into a period that is not committed yet. */
const OPEN_STATES = new Set(['open', 'calculating', 'calculated'])
/** shortcut: the newest 200 periods in scope; page per calendar when a tenant keeps more. */
const PERIOD_LIMIT = 200

const BLOCKED: Readonly<Record<string, string>> = {
  related_party: 'Refused: this payee is a related account (declared related to you or to the case’s assignee). Someone unrelated must propose it.',
  new_account: 'Refused: the payee’s account is new under the adjustment policy, which blocks adjustments to new accounts.',
}

/** ADJUSTMENT_BLOCKED in words (AC-49.1). */
export function adjustmentRefusal(error: unknown): unknown {
  if (!isApiError(error, 'ADJUSTMENT_BLOCKED')) return error
  const reason = ((error as ApiError).details as { reason?: string } | null)?.reason ?? ''
  return new ApiError(error.status, error.code, BLOCKED[reason] ?? error.message, error.details, error.requestId)
}

/**
 * "New adjustment" (SC-06, FR-CAS-002): a payee position, an open period of its market, a signed amount in the market's
 * currency, reason, note and evidence. The case opens with its evidence; the opener submits it on the case page.
 */
export function AdjustmentDialog({ onClose }: { readonly onClose: () => void }) {
  const info = caseTypeInfo('adjustment')!
  const markets = useResource<Market[]>(MARKETS_PATH)
  const periods = useResource<PeriodList>('/v1/periods', { limit: PERIOD_LIMIT })
  const [position, setPosition] = useState<TreeNode | null>(null)
  const [periodId, setPeriodId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const market = markets.data?.find((candidate) => candidate.code === position?.market_code)
  const calendars = (periods.data?.calendars ?? []).filter((calendar) => calendar.market.code === position?.market_code)
  const choices = (periods.data?.periods ?? []).flatMap((period) => {
    const calendar = calendars.find((candidate) => candidate.id === period.calendar_id)
    return calendar === undefined || !OPEN_STATES.has(period.state)
      ? []
      : [{ value: period.id, label: `${periodName(period.starts_at, period.ends_at, calendar.cutoff_time_zone)} · ${PERIOD_STATE_LABELS[period.state]}` }]
  })
  const chosenPeriod = choices.some((choice) => choice.value === periodId) ? periodId : ''

  function prepare() {
    const minor = market === undefined ? null : decimalToMinor(amount, market.minor_unit)
    const found = {
      [IDS.position]: position === null ? 'Choose the payee position.' : null,
      [IDS.period]: position !== null && chosenPeriod === '' ? 'Choose an open period.' : null,
      [IDS.amount]: minor === null || minor === '0' ? `Enter a non-zero amount${market === undefined ? '' : ` in ${market.currency} with at most ${market.minor_unit} decimals`}; a minus sign takes money back.` : null,
      [IDS.note]: requiredError('the note', note),
    }
    setErrors(found)
    return {
      items: Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }])),
      subjectType: 'position',
      subjectId: position?.position_id ?? null,
      payload: { period_id: chosenPeriod, amount_minor: minor ?? '', note: note.trim() },
    }
  }
  return (
    <Modal open onClose={onClose} title="New adjustment" size="lg" icon="exposure"
      description="A manual line for one payee in a period that is not committed yet, paid through that period's next calculation.">
      <CaseForm idPrefix={PREFIX} info={info} prepare={prepare} statement={false} explain={adjustmentRefusal} submitLabel="Open adjustment case"
        fieldIds={{ subject_id: IDS.position, 'payload.period_id': IDS.period, 'payload.amount_minor': IDS.amount, 'payload.note': IDS.note }}>
        <PositionPicker id={IDS.position} label="Payee position" kind="sponsor" chosen={position} error={errors[IDS.position]} onChoose={(node) => {
          setPosition(node)
          setPeriodId('')
        }} />
        {position !== null && (
          <Select id={IDS.period} label="Period" placeholder={periods.loading ? 'Loading periods' : 'Choose an open period'} value={chosenPeriod} options={choices} error={errors[IDS.period]}
            helper={periods.data !== null && choices.length === 0 ? `No period of ${position.market_code} is open for adjustments.` : 'Open, calculating or calculated periods of the position’s market.'}
            onChange={(event) => setPeriodId(event.target.value)} />
        )}
        <TextInput id={IDS.amount} label={`Amount${market === undefined ? '' : ` (${market.currency})`}`} inputMode="decimal" value={amount} error={errors[IDS.amount]}
          helper="Positive pays the payee more; negative (for example -5.00) takes money back." onChange={(event) => setAmount(event.target.value)} />
        <TextAreaField id={IDS.note} label="Note" helper="What the adjustment corrects; kept with the case." maxLength={NOTE_MAX} value={note} error={errors[IDS.note]} onChange={setNote} />
      </CaseForm>
    </Modal>
  )
}
