'use client'

import type { ReactNode } from 'react'
import { Icon } from '../../components/icon'
import { StatusBadge } from '../../components/status-badge'
import { formatDay } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { MONO, NOTE } from '../admin/ui'
import { BASIS_STATUS } from '../markets/format'
import { marketMoney } from '../periods/format'
import { conditionsText, effectiveText, taxYearStartText, withholdingText } from './format'
import type { BasisFields, TaxRules } from './types'

/** sc_12 rule-matrix entry (p-space-sm bg-surface-container-low rounded). */
const ENTRY = 'p-space-sm bg-surface-container-low rounded flex flex-col gap-1 min-w-0'
const CARD = 'bg-surface-container-lowest rounded-lg shadow-sm p-space-md flex flex-col gap-space-sm min-w-0'

function CardHead({ id, icon, title }: { readonly id: string; readonly icon: string; readonly title: string }) {
  return (
    <div className="flex items-center gap-space-xs">
      <Icon name={icon} size={20} className="text-secondary" />
      <h2 id={id} className="font-section-heading text-section-heading text-on-surface">{title}</h2>
    </div>
  )
}

/** Basis status chip, basis, source, review and the go-live note for a screening rule (never a legal conclusion). */
function Basis({ rule }: { readonly rule: BasisFields }) {
  return (
    <>
      <span className="font-caption text-caption text-on-surface-variant">Basis: {rule.basis} · Source: {rule.source_ref}</span>
      <span className="font-caption text-caption text-on-surface-variant">
        {effectiveText(rule)} · {rule.reviewed_by === null ? 'Not reviewed yet' : `Reviewed by ${rule.reviewed_by}${rule.reviewed_at === null ? '' : ` on ${formatDay(rule.reviewed_at)}`}`}
      </span>
      {rule.basis_status === 'screening' && <span className="font-caption text-caption text-error">Screening: needs a written risk acceptance at go-live.</span>}
    </>
  )
}

function Entry({ title, inForce, rule, children }: { readonly title: string; readonly inForce: boolean; readonly rule: BasisFields; readonly children: ReactNode }) {
  return (
    <li className={ENTRY}>
      <div className="flex flex-wrap items-center justify-between gap-space-xs">
        <span className="font-body-sm text-body-sm font-semibold text-on-surface break-words">{title}</span>
        <span className="flex flex-wrap gap-space-xs">
          <StatusBadge state={inForce ? 'active' : 'retired'} label={inForce ? 'In force' : 'Not in force'} />
          <StatusBadge {...BASIS_STATUS[rule.basis_status]} />
        </span>
      </div>
      {children}
      <Basis rule={rule} />
    </li>
  )
}

/**
 * SC-12 Withholding rules (FR-TAX-002, D-BM-03): the market pack's withholding rules (every version), its tax year,
 * tax-id format and year-end form rules. Rules come only from the pack; the tenant cannot edit them.
 */
export function RulesTab({ rules, market }: { readonly rules: TaxRules; readonly market: Market }) {
  const { withholding, year_end_forms: forms, tax_year: taxYear, tax_id_format: format } = rules
  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-md items-start">
      <section className={`${CARD} xl:col-span-7`} aria-labelledby="withholding-title" data-testid="card">
        <CardHead id="withholding-title" icon="account_tree" title="Withholding rule matrix" />
        <p className={NOTE}>Market pack <span className={MONO}>{rules.market.market_pack}</span>: {withholding.length === 0 ? 'no withholding rule.' : `${withholding.length} withholding rule version${withholding.length === 1 ? '' : 's'}.`}</p>
        {withholding.length === 0
          ? <p className="font-body-sm text-body-sm text-on-surface">This market&apos;s pack has no withholding rule: nothing is withheld and every run flags it for review.</p>
          : (
            <ul aria-label="Withholding rules" className="flex flex-col gap-space-sm">
              {withholding.map((rule) => (
                <Entry key={rule.id} title={rule.title} inForce={rule.in_force} rule={rule}>
                  <span className="font-body-sm text-body-sm text-on-surface">{withholdingText(rule, market)}</span>
                  <span className="font-caption text-caption text-secondary">{conditionsText(rule.conditions)} · <span className={MONO}>{rule.id}</span></span>
                  {rule.threshold_minor !== null && (
                    <span className="font-caption text-caption text-on-surface-variant">Payments made before this market&apos;s first committed run on the platform are not counted towards the threshold.</span>
                  )}
                </Entry>
              ))}
            </ul>
          )}
      </section>
      <div className="xl:col-span-5 flex flex-col gap-space-md min-w-0">
        <section className={CARD} aria-labelledby="tax-year-title">
          <CardHead id="tax-year-title" icon="calendar_month" title="Tax year and tax-id format" />
          <ul aria-label="Tax year and tax-id format" className="flex flex-col gap-space-sm">
            {taxYear === null
              ? <li className={NOTE}>The pack defines no tax year: thresholds and year-end statements cannot be used.</li>
              : (
                <Entry title="Tax year" inForce rule={taxYear}>
                  <span className="font-body-sm text-body-sm text-on-surface">{taxYearStartText(taxYear)}</span>
                </Entry>
              )}
            {format === null
              ? <li className={NOTE}>The pack defines no tax-id format: tax ids are checked as 4 to 32 letters, digits or hyphens.</li>
              : (
                <Entry title={`Tax-id format: ${format.label}`} inForce rule={format}>
                  <span className="font-body-sm text-body-sm text-on-surface">Tax ids are checked against this format when they are saved; one that does not match is refused.</span>
                </Entry>
              )}
          </ul>
        </section>
        <section className={CARD} aria-labelledby="forms-title">
          <CardHead id="forms-title" icon="description" title="Year-end statement" />
          {forms.length === 0 ? <p className={NOTE}>The pack defines no year-end statement: none can be generated.</p> : (
            <ul aria-label="Year-end statement rules" className="flex flex-col gap-space-sm">
              {forms.map((form) => (
                <Entry key={form.id} title={form.title} inForce={form.in_force} rule={form}>
                  <span className="font-body-sm text-body-sm text-on-surface">
                    <span className={MONO}>{form.form_type}</span>: for every payee with tax withheld{form.min_gross_minor === null ? '' : `, or gross of at least ${marketMoney(form.min_gross_minor, market)}`} in the tax year.
                  </span>
                </Entry>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
