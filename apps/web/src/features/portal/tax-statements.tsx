import { LinkButton } from '../../components/button'
import { EmptyState } from '../../components/states'
import { ApiError } from '../../lib/api'
import { CAPTION, CARD, Failure, MONO, PAGE_TITLE, TILE } from './blocks'
import { currencyDigits, formatMoney, type L10n } from './format'
import { portalSession, serverGet, settle } from './i18n/server'
import type { TaxForm } from './types'
import { DownloadLink } from './download-link'

// Portal year-end tax statements (FR-TAX-003, C-BM-11; sc_18 earnings-list pattern, no Stitch drawing), server-rendered:
// one card per tax year and form with its totals and a CSV download link (works without scripts). No W-9/1099 items,
// no "filed"/"certified" claims, no tax advice.

export async function TaxStatementsPage() {
  const session = await portalSession()
  if (session instanceof ApiError) return null
  const { words } = session
  const { t } = words
  const forms = await settle(serverGet<TaxForm[]>('/v1/me/tax-forms'))
  return (
    <>
      <h1 className={PAGE_TITLE}>{t('tax_forms.title')}</h1>
      {forms instanceof ApiError && <Failure error={forms} t={t} retry={<LinkButton href="/portal/more/tax-statements">{t('common.try_again')}</LinkButton>} />}
      {!(forms instanceof ApiError) && forms.data.length === 0 && <EmptyState title={t('tax_forms.empty')}>{t('tax_forms.empty_text')}</EmptyState>}
      {!(forms instanceof ApiError) && forms.data.length > 0 && (
        <ul className="flex flex-col gap-space-sm" data-testid="card">
          {forms.data.map((form) => <FormCard key={form.id} form={form} words={words} />)}
        </ul>
      )}
    </>
  )
}

function FormCard({ form, words }: { readonly form: TaxForm; readonly words: L10n }) {
  const { t, locale } = words
  const money = (minor: string) => formatMoney(minor, form.currency, currencyDigits(form.currency), locale)
  return (
    <li className={`${CARD} flex flex-col gap-space-sm`}>
      <div className="flex flex-col min-w-0">
        <span className="font-caption text-caption uppercase tracking-wider text-secondary font-semibold">{t('tax_forms.year', { year: String(form.tax_year) })}</span>
        <h2 className="font-section-heading text-section-heading text-on-surface break-words">{form.title}</h2>
        <span className={`${MONO} text-on-surface-variant`}>{t('tax_forms.version', { type: form.form_type, version: form.version })}</span>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <div className={`${TILE} flex flex-col min-w-0`}>
          <dt className={CAPTION}>{t('tax_forms.gross')}</dt>
          <dd className="font-data-mono-md text-data-mono-md text-on-surface break-words">{money(form.totals.gross_minor)}</dd>
        </div>
        <div className={`${TILE} flex flex-col min-w-0`}>
          <dt className={CAPTION}>{t('tax_forms.withheld')}</dt>
          <dd className="font-data-mono-md text-data-mono-md text-on-surface break-words">{money(form.totals.withheld_minor)}</dd>
        </div>
      </dl>
      <span className={CAPTION}>{t('tax_forms.created', { at: words.time(form.created_at) })}</span>
      <DownloadLink href={`/v1/me/tax-forms/${form.id}/download`} label={t('tax_forms.download')} testId="primary-action" />
    </li>
  )
}
