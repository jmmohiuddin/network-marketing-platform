'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon } from '../../components/icon'
import { formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useResource } from '../../lib/use-resource'
import { marketMoney, PERIOD_STATE_LABELS, signedMoney } from '../periods/format'
import type { PeriodState } from '../periods/types'
import { CheckLine, PathVector } from './effect-preview'
import { escalationText } from './format'
import { PeriodLink } from './refs'
import type { AdjustmentPreview, BankDetailPreview, CaseRecord, PayeeRef, ReturnedPaymentPreview, WriteOffPreview } from './types'

// Effect previews of the B4 money cases (PLAN B4 §2.1–2.3): adjustment, write-off, bank-detail change, returned payment.

const MONO = 'font-data-mono-sm text-data-mono-sm'

/** The case's market (its subject's market): currency, minor unit and zone of its amounts. */
export function useCaseMarket(record: CaseRecord): Market | undefined {
  const markets = useResource<Market[]>(MARKETS_PATH)
  return markets.data?.find((market) => market.id === record.market_id)
}

function Facts({ items }: { readonly items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 min-w-0">
          <dt className="font-caption text-caption uppercase text-secondary font-semibold">{label}</dt>
          <dd className="font-body-sm text-body-sm text-on-surface break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export const payeeLink = (ref: PayeeRef) => <Link className="text-primary font-semibold hover:underline" href={`/people/${ref.id}`}>{ref.external_ref}{ref.display_name === null ? '' : ` · ${ref.display_name}`}</Link>

/** "2 approvals" with the escalation reasons that make it two. */
function Approvals({ required, reasons }: { readonly required: 1 | 2; readonly reasons: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1" data-testid="approvals-required">
      <p className="font-body-sm text-body-sm text-on-surface"><span className="font-semibold">Approvals needed:</span> {required === 2 ? '2 (two different approvers)' : '1'}</p>
      {reasons.length > 0 && (
        <ul className="flex flex-col gap-0.5" aria-label="Why a second approver is needed">
          {/* Facts that call for a second approver, not failed checks: an info mark, never the error one (BUG-103). */}
          {reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
              <Icon name="info" size={16} className="mt-0.5 shrink-0 text-primary" />
              <span>{escalationText(reason)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AdjustmentEffect({ preview, market }: { readonly preview: AdjustmentPreview; readonly market: Market | undefined }) {
  return (
    <div className="flex flex-col gap-space-sm">
      <Facts items={[
        ['Payee', <span key="payee" className="flex flex-col">{payeeLink(preview.payee.participant)}<span className={MONO}>Position {preview.payee.position.position_ref}</span></span>],
        ['Period', <span key="period"><PeriodLink id={preview.period.id} /> · {PERIOD_STATE_LABELS[preview.period.state as PeriodState] ?? preview.period.state}</span>],
        ['Amount', <span key="amount" className={`${MONO} font-semibold`}>{signedMoney(preview.amount_minor, market)}</span>],
        ['Paid through', 'The next calculation of this period, as a manual adjustment line'],
      ]} />
      <Approvals required={preview.approvals_required} reasons={preview.escalations} />
    </div>
  )
}

function WriteOffEffect({ preview, market }: { readonly preview: WriteOffPreview; readonly market: Market | undefined }) {
  return (
    <div className="flex flex-col gap-space-sm">
      <PathVector fromLabel="Receivable now" from={marketMoney(preview.receivable_minor, market)} toLabel="After the write-off" to={marketMoney(preview.after_minor, market)} />
      <Facts items={[
        ['Written off', <span key="amount" className={`${MONO} font-semibold`}>{marketMoney(preview.amount_minor, market)}</span>],
        ['Outstanding since', formatDateTime(preview.outstanding_since)],
        ['Market', preview.market.code],
      ]} />
      <CheckLine ok={preview.eligible}>{preview.eligible ? 'Eligible for write-off under the policy.' : 'Not eligible under the policy: a second approver is needed.'}</CheckLine>
      <Approvals required={preview.approvals_required} reasons={preview.reasons.filter((reason) => reason !== 'not_eligible')} />
    </div>
  )
}

function BankDetailEffect({ preview, live }: { readonly preview: BankDetailPreview; readonly live: boolean }) {
  const hours = preview.cooling_off_hours
  return (
    <div className="flex flex-col gap-space-sm">
      <PathVector fromLabel={live ? 'Current account' : 'Account when submitted'} from={preview.current_masked ?? 'No account on record'} toLabel="New account" to={preview.new_masked} />
      <Facts items={[
        ['Scheme', preview.scheme === 'iban' ? 'IBAN' : 'Local account'],
        ['Cooling-off', hours === null ? 'Not configured' : `${hours} ${hours === 1 ? 'hour' : 'hours'} without payouts after approval`],
        ['Other payees with this account', String(preview.shared_with_count)],
      ]} />
      {preview.shared_above_threshold === null
        ? <p className="font-caption text-caption text-secondary">The shared-account threshold is not configured.</p>
        : <CheckLine ok={!preview.shared_above_threshold}>{preview.shared_above_threshold ? `The account is shared by at least ${preview.shared_account_threshold} payees: check the evidence before approving.` : 'The account is not shared above the threshold.'}</CheckLine>}
    </div>
  )
}

function ReturnedEffect({ preview, market }: { readonly preview: ReturnedPaymentPreview; readonly market: Market | undefined }) {
  return (
    <Facts items={[
      ['Payee', payeeLink(preview.instruction.participant)],
      ['Amount', <span key="amount" className={`${MONO} font-semibold`}>{market === undefined ? `${preview.amount_minor} ${preview.currency} minor units` : marketMoney(preview.amount_minor, market)}</span>],
      ['Account', <span key="account" className={MONO}>{preview.instruction.bank_detail_masked}</span>],
      ['Returned', preview.returned_at === null ? '—' : formatDateTime(preview.returned_at)],
      ['Reason given', preview.reason ?? 'None'],
      ['Effect', 'The amount is back in the payee’s payable; the payee is left out of batches while this case is open'],
    ]} />
  )
}

/** The B4 preview of a case, or null for another type. */
export function MoneyEffect({ record, live }: { readonly record: CaseRecord; readonly live: boolean }) {
  const market = useCaseMarket(record)
  const preview = record.effect_preview
  switch (record.type) {
    case 'adjustment': return <AdjustmentEffect preview={preview as AdjustmentPreview} market={market} />
    case 'write_off': return <WriteOffEffect preview={preview as WriteOffPreview} market={market} />
    case 'bank_detail': return <BankDetailEffect preview={preview as BankDetailPreview} live={live} />
    case 'returned_payment': return <ReturnedEffect preview={preview as ReturnedPaymentPreview} market={market} />
    default: return null
  }
}

export const MONEY_CASE_TYPES: readonly string[] = ['adjustment', 'write_off', 'bank_detail', 'returned_payment']
