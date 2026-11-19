'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { Banner } from '../../../components/banner'
import { Button } from '../../../components/button'
import { PageHeader } from '../../../components/page-header'
import { LoadingState } from '../../../components/states'
import { useSession } from '../../../lib/session'
import { useNow } from '../../../lib/use-now'
import { useResource } from '../../../lib/use-resource'
import { formatDateTime } from '../format'
import { LoadFailure } from '../page-states'
import type { BreachContact } from '../types'
import { NOTE, NoticeCard, SECTION_CARD, SectionTitle } from '../ui'
import { AgreementsSection } from './agreements'
import { BreachContactsDialog } from './breach-contacts-dialog'
import { ChangeRequestsSection } from './change-requests'
import { POLICY_KEYS, valueText, type PolicyKey } from './labels'
import { ParticipantTypesSection } from './participant-types'
import { PolicyValue } from './policy-value'
import type { SettingKey } from './setting-dialog'
import { ContactCard, SettingRow } from './setting-row'
import { ActivePvDialog, LateOrderDayDialog, PersonalShareDialog, RankThresholdsDialog, type PersonalShare } from './threshold-dialogs'
import type { ChangeRequest, SettingEntry, SettingsView } from './types'
import { VersionDialog } from './version-dialog'
import { DiffDrawer, VersionsSection } from './versions-section'

const NUMBER = new Intl.NumberFormat()
const MINUTE_MS = 60_000
const THRESHOLD_KEYS = ['compliance.active_pv_minor', 'compliance.rank_thresholds_pv_minor', 'compliance.late_order_day', 'compliance.personal_share_flag'] as const

function volume(value: string): string {
  return NUMBER.format(BigInt(value))
}

/** Banner title while thresholds are unset; null once every threshold has a value. */
export function unsetThresholdsTitle(thresholds: readonly SettingEntry[]): string | null {
  const unset = thresholds.filter((entry) => entry.value === null).length
  if (unset === 0) return null
  if (unset === thresholds.length) return 'No thresholds are set for you'
  return unset === 1 ? '1 threshold is not set' : `${unset} thresholds are not set`
}

/** Permissions that read GET /v1/settings (ten/routes.ts SETTINGS_READERS). */
const SETTINGS_READERS = ['settings.manage', 'settings.approve', 'privacy.manage'] as const

/** PLAN B2 5 SC-29: the B2 keys of the "Participants, orders and integrations" card, each with what holds while unset. */
const B2_ROWS: readonly { readonly key: PolicyKey; readonly title: string; readonly description: string; readonly whenUnset: string; readonly retired?: true }[] = [
  { key: 'orders.crediting_event', title: 'Crediting event', description: 'Whether an order counts when it is paid or when it is fulfilled.', whenUnset: 'Orders are refused until set.' },
  { key: 'orders.attribution_precedence', title: 'Attribution precedence', description: 'Which hint names the distributor credited with an order: a link, a code or the customer’s servicer.', whenUnset: 'Orders are refused until set.' },
  { key: 'orders.purpose_required', title: 'Order purpose required', description: 'Whether each order must say if it is for resale or personal use; orders without one are flagged.', whenUnset: 'Orders without a purpose are not flagged.' },
  { key: 'orders.new_buyer_type', title: 'Type of new buyers', description: 'The participant type given to buyers an order names who are not enrolled yet.', whenUnset: 'Orders from buyers who are not enrolled are refused until set.' },
  { key: 'orders.restocking_fee_volume_effect', title: 'Restocking-fee volume effect', description: 'Whether a restocking fee reduces the volume a return takes back.', whenUnset: 'Events with a restocking fee are refused until set.' },
  { key: 'customers.reassignment_rule', title: 'Customer reassignment rule', description: 'Where the customers of a terminated position go, and after how many days.', whenUnset: 'Positions that service customers cannot be terminated until set.' },
  { key: 'participants.duplicate_matching', title: 'Duplicate matching', description: 'Which hashed signals two participants must share to open a duplicate case at enrolment.', whenUnset: 'No duplicate matching.' },
  // D-B3-06: the width moved to the plan version; the setting is read only as the fallback for markets without one.
  { key: 'genealogy.placement_width', title: 'Placement width', description: 'Retired: set on the plan version. A value kept here applies only to markets without a plan version.', whenUnset: 'Retired: set on the plan version.', retired: true },
  { key: 'integrations.sync_health', title: 'Sync health thresholds', description: 'How long a storefront or API source may go without an accepted event before it is behind, then failing.', whenUnset: 'Sources are only marked failing; behind is not measured.' },
]
/** PLAN B4 §5 SC-29: the D-B4-18 keys, each with what holds while unset (no default is shipped). */
const B4_ROWS: readonly { readonly key: PolicyKey; readonly title: string; readonly description: string; readonly whenUnset: string }[] = [
  { key: 'payouts.market_policy', title: 'Minimum payout and tax profile', description: 'Per market: the smallest payable that is paid, and whether a payee needs a tax profile to be paid.', whenUnset: 'Payout batches cannot be prepared until set.' },
  { key: 'payouts.bank_detail_cooling_off_hours', title: 'Bank-detail cooling-off', description: 'Hours a new bank account is left out of payout batches after its approval.', whenUnset: 'Bank-detail changes and payout batches are refused until set.' },
  { key: 'payouts.shared_account_threshold', title: 'Shared-account threshold', description: 'Payees sharing one bank account at which a bank-detail change is flagged to its approver.', whenUnset: 'Shared accounts are counted but not flagged.' },
  { key: 'payouts.dormant_after_days', title: 'Dormant balance age', description: 'Days a payable stays unpaid before it is listed as dormant.', whenUnset: 'The dormant balances list is not available.' },
  { key: 'payouts.provider_review_reminder_days', title: 'Provider review reminder', description: 'Days before a payout provider’s review date at which its market managers are reminded.', whenUnset: 'No reminder is sent; the review chips still show.' },
  { key: 'adjustments.policy', title: 'Adjustment policy', description: 'When a manual adjustment needs a second approver, which accounts count as new, and what happens for a related or new account.', whenUnset: 'Manual adjustments are refused until set.' },
  { key: 'write_offs.policy', title: 'Write-off policy', description: 'When a receivable is eligible for write-off and above which amount a second approver decides.', whenUnset: 'Write-offs are refused until set.' },
]
/** Keys the API refuses to write (SETTING_RETIRED): shown, never offered for a new version. */
const RETIRED_KEYS: readonly string[] = [...B2_ROWS.filter((row) => row.retired === true).map((row) => row.key), 'money.clawback_policy']

/**
 * SC-29 Tenant settings: the settings readers (settings.manage, settings.approve, privacy.manage) see the policy
 * cards; participant types and agreement versions show to the roles that propose, approve or publish them.
 */
export function SettingsPage() {
  const { can } = useSession()
  const sections = (
    <>
      {(can('settings.manage') || can('participant_type.approve')) && <ParticipantTypesSection />}
      {(can('agreement.publish') || can('market.manage') || can('market.signoff')) && <AgreementsSection />}
    </>
  )
  if (SETTINGS_READERS.some(can)) return <PolicySettings>{sections}</PolicySettings>
  return (
    <>
      <PageHeader title="Settings" summary="Participant types and the agreement versions of each market." />
      {sections}
    </>
  )
}

type Editing = { readonly kind: 'setting'; readonly key: SettingKey } | { readonly kind: 'version'; readonly key: PolicyKey }

/** The diff drawer's version, kept in the URL as ?version= (UI_UX §4.7). */
function useVersionParam(): readonly [number | null, (version: number | null) => void] {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const version = Number(params.get('version'))
  const open = (next: number | null) => router.replace(next === null ? pathname : `${pathname}?version=${next}`)
  return [Number.isInteger(version) && version > 0 ? version : null, open] as const
}

/** SC-29 Tenant settings (API-39, FR-TEN-003): money policies, plan notice, B2 policies, thresholds, breach contacts, versions. */
function PolicySettings({ children }: { readonly children: ReactNode }) {
  const { can, readOnly } = useSession()
  const settings = useResource<SettingsView>('/v1/settings')
  const requests = useResource<readonly ChangeRequest[]>('/v1/setting-change-requests', { state: 'pending' }) // at most one per money key
  const [editing, setEditing] = useState<Editing | null>(null)
  const [round, setRound] = useState(0)
  const [inspected, inspect] = useVersionParam()
  const now = useNow(MINUTE_MS)
  if (settings.error !== null) return <LoadFailure error={settings.error} onRetry={settings.reload} />
  const view = settings.data
  const writable = can('settings.manage') && !readOnly
  // Saved or cancelled (a 412 means someone else changed a setting meanwhile): read everything again.
  const refresh = () => {
    setEditing(null)
    settings.reload()
    requests.reload()
    setRound((value) => value + 1)
  }
  const entry = (key: string): SettingEntry | undefined => view?.values[key]
  const policyKeys = POLICY_KEYS.filter((key) => entry(key) !== undefined && !RETIRED_KEYS.includes(key))
  const latestVersion = typeof settings.meta.latest_version === 'number' ? settings.meta.latest_version : 0
  const dialog = { latestVersion, onClose: () => setEditing(null), onSaved: refresh }
  const changeOf = (key: SettingKey) => (writable ? () => setEditing({ kind: 'setting', key }) : undefined)
  const versionOf = (key: PolicyKey) => (writable ? () => setEditing({ kind: 'version', key }) : undefined)
  const thresholds = THRESHOLD_KEYS.flatMap((key) => entry(key) ?? [])
  const unsetTitle = thresholds.length === THRESHOLD_KEYS.length ? unsetThresholdsTitle(thresholds) : null
  const contacts = entry('privacy.breach_contacts')
  const contactList = (contacts?.value ?? null) as readonly BreachContact[] | null
  const rounding = entry('money.rounding_mode')
  const clawback = entry('money.clawback_policy')
  const notice = entry('plan.activation_notice_days')
  const visibility = entry('genealogy.visibility_policy')
  const b2Rows = B2_ROWS.flatMap((row) => {
    const found = entry(row.key)
    return found === undefined ? [] : [{ ...row, entry: found }]
  })
  const b4Rows = B4_ROWS.flatMap((row) => {
    const found = entry(row.key)
    return found === undefined ? [] : [{ ...row, entry: found }]
  })
  const values = Object.fromEntries(Object.entries(view?.values ?? {}).map(([key, setting]) => [key, setting?.value]))
  return (
    <>
      <PageHeader
        title="Settings"
        summary={view === null || view.version === null
          ? 'Values your reports, calculations and your vendor depend on. Each change is kept as a new version with its reason.'
          : `Version ${view.version} in force since ${formatDateTime(view.effective_from)}. Each change is kept as a new version with its reason.`}
        actions={writable && policyKeys.length > 0
          ? <Button variant="primary" icon="save_as" data-testid="primary-action" onClick={() => setEditing({ kind: 'version', key: policyKeys[0]! })}>Save new version with effective date</Button>
          : undefined}
      />
      <NoticeCard icon="shield_with_heart" title="Every change is a new version">
        Each version records its reason, author and the moment it takes effect; a date is never in the past. Money policy changes wait for a Finance approver who did not request them.
      </NoticeCard>
      {settings.loading && <LoadingState label="Loading settings" />}
      {view !== null && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
          <div className="lg:col-span-8 flex flex-col gap-space-md">
            {(rounding !== undefined || clawback !== undefined || notice !== undefined) && (
              <section className={SECTION_CARD} aria-labelledby="money-title">
                <SectionTitle id="money-title" icon="account_balance" title="Money policies" />
                <p className={NOTE}>How amounts are rounded and how refunds recover commission already paid, and the notice before a plan version activates.</p>
                <ul className="flex flex-col gap-space-md">
                  {rounding !== undefined && (
                    <SettingRow
                      title="Rounding mode"
                      description="How money amounts are rounded to the market currency’s minor unit."
                      unsetLabel="Platform rule"
                      whenUnset="Not set for your tenant: the platform rule BR-MNY-02 applies, rounding half up."
                      entry={rounding}
                      show={(value: string) => valueText('money.rounding_mode', value)}
                      onChange={versionOf('money.rounding_mode')}
                    />
                  )}
                  {clawback !== undefined && (
                    // D-B4-06: retired; each bonus's reversal policy on the plan version decides. Shown, never changed.
                    <SettingRow
                      title="Clawback default"
                      description="Retired: set per bonus on the plan version."
                      whenUnset="Retired: set per bonus on the plan version."
                      entry={clawback}
                      show={(value: unknown) => `Retired (last value: ${valueText('money.clawback_policy', value)})`}
                    />
                  )}
                  {notice !== undefined && (
                    <SettingRow
                      title="Plan notice period"
                      description="Days of notice before a new plan version activates (BR-PLN-04)."
                      whenUnset="No notice period is recorded. The product ships none."
                      entry={notice}
                      show={(value: number) => valueText('plan.activation_notice_days', value)}
                      onChange={versionOf('plan.activation_notice_days')}
                    />
                  )}
                </ul>
              </section>
            )}
            {contacts !== undefined && (
              <section className={SECTION_CARD} aria-labelledby="breach-title">
                <SectionTitle
                  id="breach-title"
                  icon="contact_phone"
                  title="Breach-notification contacts"
                  action={writable ? <Button icon="edit" onClick={() => setEditing({ kind: 'setting', key: 'privacy.breach_contacts' })}>{contactList === null ? 'Add contacts' : 'Change contacts'}</Button> : undefined}
                />
                <p className={NOTE}>People to notify when personal data may have been breached.</p>
                {contactList === null && (
                  <Banner tone="warning" title="No breach contact recorded">
                    Go-live and the first data load are blocked until at least one contact is recorded.
                  </Banner>
                )}
                {contactList !== null && contacts.value_since !== null && (
                  <p className="font-caption text-caption text-secondary">In force since {formatDateTime(contacts.value_since.effective_from)} (version {contacts.value_since.version}).</p>
                )}
                {contactList !== null && (
                  <ul aria-label="Breach-notification contacts" className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
                    {contactList.map((contact) => <ContactCard key={`${contact.email}|${contact.name}`} contact={contact} />)}
                  </ul>
                )}
              </section>
            )}
          </div>
          <div className="lg:col-span-4 flex flex-col gap-space-md">
            {visibility !== undefined && (
              <section className={SECTION_CARD} aria-labelledby="visibility-title" data-testid="visibility-policy">
                <SectionTitle id="visibility-title" icon="visibility_off" title="Privacy and visibility" />
                <p className={NOTE}>What a distributor sees of their downline. Every change waits for the DPO’s approval.</p>
                <ul className="flex flex-col gap-space-md">
                  <SettingRow
                    title="Downline depth masking"
                    description="Levels named to a distributor; deeper levels show only as counts per level."
                    unsetLabel="Platform safe default in force"
                    whenUnset="Names 1 level down; contact of personally sponsored hidden."
                    entry={visibility}
                    show={(value: unknown) => valueText('genealogy.visibility_policy', value)}
                    onChange={versionOf('genealogy.visibility_policy')}
                    stacked
                  />
                </ul>
              </section>
            )}
            <ChangeRequestsSection requests={requests} onChanged={refresh} />
          </div>
        </div>
      )}
      {thresholds.length > 0 && (
        <section className={SECTION_CARD} aria-labelledby="thresholds-title">
          <SectionTitle id="thresholds-title" icon="tune" title="Compliance thresholds" />
          <p className={NOTE}>The values the compliance reports apply. The product ships no default values.</p>
          {unsetTitle !== null && (
            <Banner tone="info" title={unsetTitle}>
              While a threshold is not set, reports leave out the indicator that needs it and say so. Agree each value with your compliance adviser or counsel.
            </Banner>
          )}
          <ul className="flex flex-col gap-space-md">
            {entry('compliance.active_pv_minor') !== undefined && (
              <SettingRow
                title="Active earner threshold"
                description="Personal volume in a month at which an earner counts as active (report R4)."
                whenUnset="Report R4 leaves out the active-earner figures."
                entry={entry('compliance.active_pv_minor')!}
                show={(value: string) => `${volume(value)} (minor units of volume)`}
                onChange={changeOf('compliance.active_pv_minor')}
              />
            )}
            {entry('compliance.rank_thresholds_pv_minor') !== undefined && (
              <SettingRow
                title="Rank thresholds"
                description="Personal volume at which each rank is reached; late orders that cross one are counted (report R4)."
                whenUnset="Report R4 leaves out the count of late orders crossing a rank threshold."
                entry={entry('compliance.rank_thresholds_pv_minor')!}
                show={(value: Readonly<Record<string, string>>) => (
                  <ul className="flex flex-col gap-0.5">{Object.entries(value).map(([name, threshold]) => <li key={name}>{name}: {volume(threshold)}</li>)}</ul>
                )}
                onChange={changeOf('compliance.rank_thresholds_pv_minor')}
              />
            )}
            {entry('compliance.late_order_day') !== undefined && (
              <SettingRow
                title="Late-order day"
                description="Day of the month from which an order counts as placed at the end of the period (report R4)."
                whenUnset="Report R4 leaves out the late-order figures."
                entry={entry('compliance.late_order_day')!}
                show={(value: number) => `Day ${value} of the month`}
                onChange={changeOf('compliance.late_order_day')}
              />
            )}
            {entry('compliance.personal_share_flag') !== undefined && (
              <SettingRow
                title="Personal-use flag"
                description="Share of a payee’s multi-level pay from personal-use orders above which the payee is flagged (report R2)."
                whenUnset="Report R2 shows the shares but leaves out the count of flagged payees."
                entry={entry('compliance.personal_share_flag')!}
                show={(value: PersonalShare) => `More than ${value.numerator} out of ${value.denominator}`}
                onChange={changeOf('compliance.personal_share_flag')}
              />
            )}
          </ul>
        </section>
      )}
      {b2Rows.length > 0 && (
        <section className={SECTION_CARD} aria-labelledby="operations-title">
          <SectionTitle id="operations-title" icon="settings_applications" title="Participants, orders and integrations" />
          <p className={NOTE}>How enrolments, orders and storefront syncs are handled. The product ships no default value for any of them.</p>
          <ul className="flex flex-col gap-space-md">
            {b2Rows.map((row) => (
              <SettingRow key={row.key} title={row.title} description={row.description} whenUnset={row.whenUnset} entry={row.entry}
                show={(value: unknown) => valueText(row.key, value)} onChange={row.retired ? undefined : versionOf(row.key)} />
            ))}
          </ul>
        </section>
      )}
      {b4Rows.length > 0 && (
        <section className={SECTION_CARD} aria-labelledby="payouts-title" data-testid="payout-policies">
          <SectionTitle id="payouts-title" icon="payments" title="Payouts, adjustments and write-offs" />
          <p className={NOTE}>Rules for paying out earnings balances, manual adjustments and write-offs. The product ships no default value; each change waits for a Finance approver where marked.</p>
          <ul className="flex flex-col gap-space-md">
            {b4Rows.map((row) => (
              <SettingRow key={row.key} title={row.title} description={row.description} whenUnset={row.whenUnset} entry={row.entry}
                show={(value: unknown) => <PolicyValue name={row.key} value={value} />}
                onChange={versionOf(row.key)} />
            ))}
          </ul>
        </section>
      )}
      {children}
      {view !== null && <VersionsSection key={round} inForce={view.version} now={now} onInspect={inspect} />}
      {inspected !== null && <DiffDrawer version={inspected} onClose={() => inspect(null)} />}
      {editing?.kind === 'version' && <VersionDialog keys={policyKeys} initialKey={editing.key} values={values} latestVersion={latestVersion} onClose={dialog.onClose} onSaved={refresh} />}
      {editing?.kind === 'setting' && editing.key === 'compliance.active_pv_minor' && <ActivePvDialog {...dialog} title="Active earner threshold" current={entry(editing.key)?.value as string | null} />}
      {editing?.kind === 'setting' && editing.key === 'compliance.rank_thresholds_pv_minor' && <RankThresholdsDialog {...dialog} title="Rank thresholds" current={entry(editing.key)?.value as Record<string, string> | null} />}
      {editing?.kind === 'setting' && editing.key === 'compliance.late_order_day' && <LateOrderDayDialog {...dialog} title="Late-order day" current={entry(editing.key)?.value as number | null} />}
      {editing?.kind === 'setting' && editing.key === 'compliance.personal_share_flag' && <PersonalShareDialog {...dialog} title="Personal-use flag" current={entry(editing.key)?.value as PersonalShare | null} />}
      {editing?.kind === 'setting' && editing.key === 'privacy.breach_contacts' && <BreachContactsDialog {...dialog} title="Breach-notification contacts" current={contactList} />}
    </>
  )
}
