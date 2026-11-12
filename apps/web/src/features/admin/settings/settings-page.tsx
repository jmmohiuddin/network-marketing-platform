'use client'

import { useState, type ReactNode } from 'react'
import { Banner } from '../../../components/banner'
import { Button } from '../../../components/button'
import { Icon } from '../../../components/icon'
import { PageHeader } from '../../../components/page-header'
import { LoadingState } from '../../../components/states'
import { StatusBadge } from '../../../components/status-badge'
import { isNotAvailable } from '../../../lib/messages'
import { formatDateTime } from '../format'
import { LoadFailure } from '../page-states'
import { useSession } from '../../../lib/session'
import { useResource, type Resource } from '../../../lib/use-resource'
import type { BreachContact, SettingRead } from '../types'
import { MONO, NOTE, NoticeCard, SECTION_CARD, SectionTitle } from '../ui'
import { BreachContactsDialog } from './breach-contacts-dialog'
import type { SettingKey } from './setting-dialog'
import { ActivePvDialog, LateOrderDayDialog, PersonalShareDialog, RankThresholdsDialog, type PersonalShare } from './threshold-dialogs'

const NUMBER = new Intl.NumberFormat()

function volume(value: string): string {
  return NUMBER.format(BigInt(value))
}

interface RowProps {
  readonly title: string
  readonly description: string
  /** What reports do while the value is unset (DEC-14, E-ADR-11: no default is shipped). */
  readonly whenUnset: string
  readonly setting: Resource<SettingRead<unknown>>
  readonly show: (value: never) => ReactNode
  readonly onChange: () => void
}

/** sc_29 policy row: name and explanation on the left, the value in force and Change on the right. */
function SettingRow({ title, description, whenUnset, setting, show, onChange }: RowProps) {
  const { readOnly } = useSession()
  const titleId = `setting-${title.replace(/\W+/g, '-').toLowerCase()}`
  const read = setting.data
  return (
    <li className="p-space-md rounded bg-surface-container-low flex flex-col md:flex-row md:items-center justify-between gap-space-md" aria-labelledby={titleId}>
      <div className="max-w-md flex flex-col gap-1">
        <h3 id={titleId} className="font-section-heading text-section-heading text-on-surface">{title}</h3>
        <p className={NOTE}>{description}</p>
        {read !== null && read.value !== null && (
          <p className="font-caption text-caption text-secondary">In force since {formatDateTime(read.effective_from)} (version {read.version}).</p>
        )}
      </div>
      <div className="flex flex-col md:items-end gap-space-sm shrink-0 md:max-w-xs">
        {setting.loading && <LoadingState label={`Loading ${title.toLowerCase()}`} />}
        {setting.error !== null && <LoadFailure error={setting.error} onRetry={setting.reload} section />}
        {read !== null && read.value === null && (
          <div className="flex flex-col md:items-end gap-1">
            <StatusBadge state="draft" label="Not set" />
            <span className="font-caption text-caption text-secondary md:text-right">{whenUnset}</span>
          </div>
        )}
        {read !== null && read.value !== null && <div className="font-data-mono-md text-data-mono-md text-on-surface font-semibold md:text-right">{show(read.value as never)}</div>}
        {!readOnly && read !== null && <Button size="sm" icon="edit" aria-label={`Change ${title.toLowerCase()}`} onClick={onChange}>Change</Button>}
      </div>
    </li>
  )
}

/** sc_29 breach contact card: role caption, name, email and phone in mono. */
function ContactCard({ contact }: { readonly contact: BreachContact }) {
  return (
    <li className="p-space-md rounded bg-surface-container-low flex items-start justify-between gap-space-sm">
      <div className="min-w-0">
        <span className="font-caption text-caption uppercase tracking-wider text-secondary">{contact.role}</span>
        <h3 className="font-section-heading text-section-heading text-on-surface font-semibold mt-0.5">{contact.name}</h3>
        <p className={`${MONO} text-primary mt-1 break-all`}>{contact.email}</p>
        <p className={`${MONO} text-primary break-all`}>{contact.phone}</p>
      </div>
      <div className="w-8 h-8 rounded bg-surface-container flex items-center justify-center text-primary shrink-0">
        <Icon name="contact_phone" size={18} />
      </div>
    </li>
  )
}

const PATH = '/v1/settings/'

/** Banner title while thresholds are unset; null once every threshold has a value (or none has loaded yet). */
export function unsetThresholdsTitle(thresholds: readonly Resource<SettingRead<unknown>>[]): string | null {
  const unset = thresholds.filter((setting) => setting.data !== null && setting.data.value === null).length
  if (unset === 0) return null
  if (unset === thresholds.length) return 'No thresholds are set for you'
  return unset === 1 ? '1 threshold is not set' : `${unset} thresholds are not set`
}

/** Tenant settings for release A (API-39; MVP_A C-1 slice of SC-29): compliance thresholds and breach contacts. */
export function SettingsPage() {
  const { readOnly } = useSession()
  const activePv = useResource<SettingRead<unknown>>(`${PATH}compliance.active_pv_minor`)
  const ranks = useResource<SettingRead<unknown>>(`${PATH}compliance.rank_thresholds_pv_minor`)
  const lateDay = useResource<SettingRead<unknown>>(`${PATH}compliance.late_order_day`)
  const share = useResource<SettingRead<unknown>>(`${PATH}compliance.personal_share_flag`)
  const contacts = useResource<SettingRead<unknown>>(`${PATH}privacy.breach_contacts`)
  const all = [activePv, ranks, lateDay, share, contacts]
  const [editing, setEditing] = useState<SettingKey | null>(null)
  const failure = all.map((setting) => setting.error).find(isNotAvailable)
  if (failure !== undefined) return <LoadFailure error={failure} onRetry={() => all.forEach((setting) => setting.reload())} />
  // Every key shares one version counter: the newest one seen is the If-Match base of the next change.
  const latestVersion = Math.max(0, ...all.map((setting) => (typeof setting.meta.latest_version === 'number' ? setting.meta.latest_version : 0)))
  // Saved or cancelled (a 412 means someone else changed a setting): read everything again.
  const close = () => {
    setEditing(null)
    all.forEach((setting) => setting.reload())
  }
  const dialog = { latestVersion, onClose: close, onSaved: close }
  const contactList = (contacts.data?.value ?? null) as readonly BreachContact[] | null
  const unsetTitle = unsetThresholdsTitle([activePv, ranks, lateDay, share])
  return (
    <>
      <PageHeader title="Settings" summary="Values your reports and your vendor depend on. Each change is kept as a new version with its reason." />
      <NoticeCard icon="shield_with_heart" title="Every change is a new version">
        A change applies from the moment you save it and is recorded in the audit log with your reason. Earlier versions stay on record.
      </NoticeCard>
      <section className={SECTION_CARD} aria-labelledby="thresholds-title">
        <SectionTitle id="thresholds-title" icon="tune" title="Compliance thresholds" />
        <p className={NOTE}>The values the compliance reports apply. The product ships no default values.</p>
        {unsetTitle !== null && (
          <Banner tone="info" title={unsetTitle}>
            While a threshold is not set, reports leave out the indicator that needs it and say so. Agree each value with your compliance adviser or counsel.
          </Banner>
        )}
        <ul className="flex flex-col gap-space-md">
          <SettingRow
            title="Active earner threshold"
            description="Personal volume in a month at which an earner counts as active (report R4)."
            whenUnset="Report R4 leaves out the active-earner figures."
            setting={activePv}
            show={(value: string) => `${volume(value)} (minor units of volume)`}
            onChange={() => setEditing('compliance.active_pv_minor')}
          />
          <SettingRow
            title="Rank thresholds"
            description="Personal volume at which each rank is reached; late orders that cross one are counted (report R4)."
            whenUnset="Report R4 leaves out the count of late orders crossing a rank threshold."
            setting={ranks}
            show={(value: Readonly<Record<string, string>>) => (
              <ul className="flex flex-col gap-0.5">{Object.entries(value).map(([name, threshold]) => <li key={name}>{name}: {volume(threshold)}</li>)}</ul>
            )}
            onChange={() => setEditing('compliance.rank_thresholds_pv_minor')}
          />
          <SettingRow
            title="Late-order day"
            description="Day of the month from which an order counts as placed at the end of the period (report R4)."
            whenUnset="Report R4 leaves out the late-order figures."
            setting={lateDay}
            show={(value: number) => `Day ${value} of the month`}
            onChange={() => setEditing('compliance.late_order_day')}
          />
          <SettingRow
            title="Personal-use flag"
            description="Share of a payee’s multi-level pay from personal-use orders above which the payee is flagged (report R2)."
            whenUnset="Report R2 shows the shares but leaves out the count of flagged payees."
            setting={share}
            show={(value: PersonalShare) => `More than ${value.numerator} out of ${value.denominator}`}
            onChange={() => setEditing('compliance.personal_share_flag')}
          />
        </ul>
      </section>
      <section className={SECTION_CARD} aria-labelledby="breach-title">
        <SectionTitle
          id="breach-title"
          icon="contact_phone"
          title="Breach-notification contacts"
          action={!readOnly && contacts.data !== null
            ? <Button icon="edit" onClick={() => setEditing('privacy.breach_contacts')}>{contactList === null ? 'Add contacts' : 'Change contacts'}</Button>
            : undefined}
        />
        <p className={NOTE}>People to notify when personal data may have been breached.</p>
        {contacts.loading && <LoadingState label="Loading breach-notification contacts" />}
        {contacts.error !== null && <LoadFailure error={contacts.error} onRetry={contacts.reload} section />}
        {contacts.data !== null && contactList === null && (
          <Banner tone="warning" title="No breach contact recorded">
            Go-live and the first data load are blocked until at least one contact is recorded.
          </Banner>
        )}
        {contactList !== null && (
          <ul aria-label="Breach-notification contacts" className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
            {contactList.map((contact) => <ContactCard key={`${contact.email}|${contact.name}`} contact={contact} />)}
          </ul>
        )}
      </section>
      {editing === 'compliance.active_pv_minor' && <ActivePvDialog {...dialog} title="Active earner threshold" current={activePv.data?.value as string | null} />}
      {editing === 'compliance.rank_thresholds_pv_minor' && <RankThresholdsDialog {...dialog} title="Rank thresholds" current={ranks.data?.value as Record<string, string> | null} />}
      {editing === 'compliance.late_order_day' && <LateOrderDayDialog {...dialog} title="Late-order day" current={lateDay.data?.value as number | null} />}
      {editing === 'compliance.personal_share_flag' && <PersonalShareDialog {...dialog} title="Personal-use flag" current={share.data?.value as PersonalShare | null} />}
      {editing === 'privacy.breach_contacts' && <BreachContactsDialog {...dialog} title="Breach-notification contacts" current={contactList} />}
    </>
  )
}
