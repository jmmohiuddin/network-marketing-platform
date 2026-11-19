'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useResource } from '../../lib/use-resource'
import { marketMoney } from '../periods/format'
import { marketsById, payeeText } from './format'
import type { PayeeRef, Reason } from './types'

// sc_03 / sc_34 surfaces, as drawn.
export const CARD = 'bg-surface-container-lowest rounded shadow-sm'
export const LABEL = 'font-caption text-caption uppercase text-secondary font-semibold tracking-wider'
export const MONO = 'font-data-mono-sm text-data-mono-sm'
export const LINK = 'text-primary font-semibold hover:underline'

/** Markets by id, for money (currency, minor unit) and codes; empty until GET /v1/markets answers. */
export function useMarkets(): ReadonlyMap<string, Market> {
  return marketsById(useResource<readonly Market[]>(MARKETS_PATH).data)
}

export function PayeeLink({ payee }: { readonly payee: PayeeRef }) {
  return <Link className={LINK} href={`/people/${payee.id}`}>{payeeText(payee)}</Link>
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** One D-B4-12 exclusion (or retry skip) reason in words, with its date or the case, hold or batch it names. */
export function ReasonText({ reason, market }: { readonly reason: Reason; readonly market: Market | undefined }) {
  const d = reason.detail
  switch (reason.reason) {
    case 'below_minimum':
      return <>Below the market minimum of {marketMoney(text(d.minimum_minor), market)}</>
    case 'no_bank_details':
      return <>No bank details on record</>
    case 'bank_detail_cooling_off':
      return <>Bank details changed: cooling off until {formatDateTime(text(d.until))}</>
    case 'duplicate_case':
      return <>Open <Link className={LINK} href={`/cases/${text(d.case_id)}`}>duplicate case</Link></>
    case 'tax_profile_missing':
      return <>No tax profile: the market requires one</>
    case 'hold':
      // Batches prepared before placed_at was added keep a hold reason without its date.
      return <>On hold{text(d.placed_at) === '' ? '' : ` since ${formatDateTime(text(d.placed_at))}`}: {text(d.reason)}</>
    case 'returned_payment_open':
      return <>Open <Link className={LINK} href={`/cases/${text(d.case_id)}`}>returned-payment case</Link></>
    case 'in_open_batch':
      return <>A payment is in flight in <Link className={LINK} href={`/payouts/${text(d.batch_id)}`}>another batch</Link></>
    case 'nothing_payable':
      return <>Nothing payable now</>
    default:
      return <>{reason.reason.replaceAll('_', ' ')}</>
  }
}

export function ReasonList({ reasons, market }: { readonly reasons: readonly Reason[]; readonly market: Market | undefined }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {reasons.map((reason) => <li key={`${reason.reason}-${JSON.stringify(reason.detail)}`}><ReasonText reason={reason} market={market} /></li>)}
    </ul>
  )
}

/** sc_03 "Batch Register" card: section-heading toolbar over the table. */
export function RegisterCard({ title, note, children }: { readonly title: string; readonly note?: ReactNode; readonly children: ReactNode }) {
  return (
    <section aria-label={title} className={`${CARD} overflow-hidden flex flex-col`} data-testid="card">
      <div className="px-space-md py-space-xs bg-surface-container-low flex flex-wrap items-center justify-between gap-space-sm">
        <h2 className="font-section-heading text-section-heading text-on-surface font-semibold">{title}</h2>
        {note !== undefined && <span className="font-caption text-caption text-secondary">{note}</span>}
      </div>
      {children}
    </section>
  )
}
