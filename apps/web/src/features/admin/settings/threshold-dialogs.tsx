'use client'

import { useState } from 'react'
import { Button } from '../../../components/button'
import { TextField } from '../../../components/form-field'
import type { SummaryItem } from '../../../components/error-summary'
import { minorUnitsError, SettingDialog, type SettingDialogProps } from './setting-dialog'

/** What every threshold dialog gets from the page: version, title and close/saved callbacks. */
export type ThresholdDialogProps<T> = Omit<SettingDialogProps, 'settingKey' | 'build' | 'children'> & { readonly current: T | null }

export interface PersonalShare {
  readonly numerator: string
  readonly denominator: string
}

const ACTIVE_ID = 'setting-active-pv'
const DAY_ID = 'setting-late-day'
const NUMERATOR_ID = 'setting-share-numerator'
const DENOMINATOR_ID = 'setting-share-denominator'
const RANK_NAME_MAX = 64
const LAST_DAY = 31
const DAY = /^\d{1,2}$/

const item = (fieldId: string, message: string | null): SummaryItem[] => (message === null ? [] : [{ fieldId, message }])

/** R4 active threshold (compliance.active_pv_minor). */
export function ActivePvDialog({ current, ...props }: ThresholdDialogProps<string>) {
  const [value, setValue] = useState(current ?? '')
  const [error, setError] = useState<string | null>(null)
  function build() {
    const found = minorUnitsError(value, 'the personal volume')
    setError(found)
    return found === null ? { value: value.trim(), items: [] } : { items: item(ACTIVE_ID, found) }
  }
  return (
    <SettingDialog {...props} settingKey="compliance.active_pv_minor" build={build}>
      <TextField
        id={ACTIVE_ID}
        label="Personal volume that makes an earner active"
        helper="In the minor units of the volume columns of your import files, for example cents."
        inputMode="numeric"
        data-autofocus
        value={value}
        error={error}
        onChange={(event) => setValue(event.target.value)}
      />
    </SettingDialog>
  )
}

/** R4 end-of-period threshold orders (compliance.late_order_day). */
export function LateOrderDayDialog({ current, ...props }: ThresholdDialogProps<number>) {
  const [value, setValue] = useState(current === null ? '' : String(current))
  const [error, setError] = useState<string | null>(null)
  function build() {
    const day = Number(value.trim())
    const found = DAY.test(value.trim()) && day >= 1 && day <= LAST_DAY ? null : `Enter a day of the month from 1 to ${LAST_DAY}.`
    setError(found)
    return found === null ? { value: day, items: [] } : { items: item(DAY_ID, found) }
  }
  return (
    <SettingDialog {...props} settingKey="compliance.late_order_day" build={build}>
      <TextField
        id={DAY_ID}
        label="Day of the month from which an order counts as late"
        helper="Orders on this day or later are checked for crossing a rank threshold at the end of the period."
        inputMode="numeric"
        data-autofocus
        value={value}
        error={error}
        onChange={(event) => setValue(event.target.value)}
      />
    </SettingDialog>
  )
}

/** The flag as an exact fraction: numerator <= denominator, denominator > 0. */
export function shareErrors(share: PersonalShare): { numerator: string | null; denominator: string | null } {
  const numerator = minorUnitsError(share.numerator, 'the first number')
  const denominator = minorUnitsError(share.denominator, 'the second number')
    ?? (BigInt(share.denominator.trim()) === 0n ? 'The second number must be greater than zero.' : null)
  if (numerator !== null || denominator !== null) return { numerator, denominator }
  return { numerator: BigInt(share.numerator.trim()) > BigInt(share.denominator.trim()) ? 'The first number cannot be larger than the second.' : null, denominator: null }
}

/** R2 personal-use flag (compliance.personal_share_flag), set by the tenant's counsel. */
export function PersonalShareDialog({ current, ...props }: ThresholdDialogProps<PersonalShare>) {
  const [share, setShare] = useState<PersonalShare>(current ?? { numerator: '', denominator: '' })
  const [errors, setErrors] = useState<{ numerator: string | null; denominator: string | null }>({ numerator: null, denominator: null })
  function build() {
    const found = shareErrors(share)
    setErrors(found)
    const items = [...item(NUMERATOR_ID, found.numerator), ...item(DENOMINATOR_ID, found.denominator)]
    return items.length > 0 ? { items } : { value: { numerator: share.numerator.trim(), denominator: share.denominator.trim() }, items }
  }
  return (
    <SettingDialog {...props} settingKey="compliance.personal_share_flag" build={build}>
      <p>A payee is flagged when more than this share of their multi-level pay comes from orders bought for personal use.</p>
      <div className="admin-pair">
        <TextField id={NUMERATOR_ID} label="Share" inputMode="numeric" data-autofocus value={share.numerator} error={errors.numerator} onChange={(event) => setShare({ ...share, numerator: event.target.value })} />
        <TextField id={DENOMINATOR_ID} label="Out of" inputMode="numeric" value={share.denominator} error={errors.denominator} onChange={(event) => setShare({ ...share, denominator: event.target.value })} />
      </div>
      <p className="admin-note">For example 1 out of 3, or 30 out of 100. The fraction is kept exactly.</p>
    </SettingDialog>
  )
}

interface RankRow {
  readonly id: number
  readonly name: string
  readonly threshold: string
}

/** Rank rows -> errors per row and field, or the record to store. */
export function checkRanks(rows: readonly { readonly name: string; readonly threshold: string }[]): { value: Record<string, string> | null; errors: Record<string, string> } {
  const errors = Object.fromEntries(rows.flatMap((row, index) => {
    const name = row.name.trim()
    const nameError = name === '' ? 'Enter the rank name.'
      : name.length > RANK_NAME_MAX ? `Use at most ${RANK_NAME_MAX} characters.`
        : rows.findIndex((other) => other.name.trim() === name) !== index ? 'Each rank name may appear once.' : null
    const thresholdError = minorUnitsError(row.threshold, 'the personal volume')
    return [...(nameError === null ? [] : [[`rank-${index}-name`, nameError]]), ...(thresholdError === null ? [] : [[`rank-${index}-threshold`, thresholdError]])]
  }))
  if (rows.length === 0) return { value: null, errors: { 'rank-add': 'Add at least one rank.' } }
  if (Object.keys(errors).length > 0) return { value: null, errors }
  return { value: Object.fromEntries(rows.map((row) => [row.name.trim(), row.threshold.trim()])), errors: {} }
}

/** R4 rank thresholds (compliance.rank_thresholds_pv_minor): rank name -> personal volume. */
export function RankThresholdsDialog({ current, ...props }: ThresholdDialogProps<Readonly<Record<string, string>>>) {
  const [rows, setRows] = useState<readonly RankRow[]>(() => Object.entries(current ?? {}).map(([name, threshold], id) => ({ id, name, threshold })))
  const [nextId, setNextId] = useState(rows.length)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const update = (id: number, change: Partial<RankRow>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row)))
  function add() {
    setRows((current) => [...current, { id: nextId, name: '', threshold: '' }])
    setNextId((id) => id + 1)
  }
  function build() {
    const checked = checkRanks(rows)
    setErrors(checked.errors)
    const items = Object.entries(checked.errors).map(([fieldId, message]) => ({ fieldId, message }))
    return checked.value === null ? { items } : { value: checked.value, items }
  }
  return (
    <SettingDialog {...props} settingKey="compliance.rank_thresholds_pv_minor" build={build}>
      <p>Personal volume at which each rank is reached, in the minor units of your import files.</p>
      {rows.map((row, index) => (
        <div key={row.id} className="admin-group">
          <div className="admin-pair">
            <TextField id={`rank-${index}-name`} label="Rank name" maxLength={RANK_NAME_MAX} value={row.name} error={errors[`rank-${index}-name`]} onChange={(event) => update(row.id, { name: event.target.value })} />
            <TextField id={`rank-${index}-threshold`} label="Personal volume" inputMode="numeric" value={row.threshold} error={errors[`rank-${index}-threshold`]} onChange={(event) => update(row.id, { threshold: event.target.value })} />
          </div>
          <div className="form-actions">
            <Button variant="tertiary" onClick={() => setRows((current) => current.filter((other) => other.id !== row.id))}>Remove rank {row.name.trim()}</Button>
          </div>
        </div>
      ))}
      <div>
        <Button id="rank-add" onClick={add}>Add rank</Button>
      </div>
    </SettingDialog>
  )
}
