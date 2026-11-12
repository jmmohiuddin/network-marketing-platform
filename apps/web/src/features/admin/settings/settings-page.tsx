'use client'

import { useState, type ReactNode } from 'react'
import { Banner } from '../../../components/banner'
import { Button } from '../../../components/button'
import { PageHeader } from '../../../components/page-header'
import { LoadingState } from '../../../components/states'
import { StatusChip } from '../../../components/status-chip'
import { Table, type TableColumn } from '../../../components/table'
import { isNotAvailable } from '../../../lib/messages'
import { formatDateTime } from '../format'
import { LoadFailure } from '../page-states'
import { useSession } from '../../../lib/session'
import { useResource, type Resource } from '../../../lib/use-resource'
import type { BreachContact, SettingRead } from '../types'
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

function SettingRow({ title, description, whenUnset, setting, show, onChange }: RowProps) {
  const { readOnly } = useSession()
  const titleId = `setting-${title.replace(/\W+/g, '-').toLowerCase()}`
  const read = setting.data
  return (
    <li className="admin-card" aria-labelledby={titleId}>
      <div className="admin-card-header">
        <h3 id={titleId} className="admin-card-title">{title}</h3>
        {!readOnly && read !== null && <Button aria-label={`Change ${title.toLowerCase()}`} onClick={onChange}>Change</Button>}
      </div>
      <p>{description}</p>
      {setting.loading && <LoadingState label={`Loading ${title.toLowerCase()}`} />}
      {setting.error !== null && <LoadFailure error={setting.error} onRetry={setting.reload} section />}
      {read !== null && read.value === null && (
        <div className="admin-role-line">
          <StatusChip state="draft" label="Not set" />
          <span>{whenUnset}</span>
        </div>
      )}
      {read !== null && read.value !== null && (
        <>
          <div>{show(read.value as never)}</div>
          <p className="admin-note">In force since {formatDateTime(read.effective_from)} (version {read.version}).</p>
        </>
      )}
    </li>
  )
}

const CONTACT_COLUMNS: readonly TableColumn<BreachContact>[] = [
  { key: 'name', header: 'Name', cell: (contact) => contact.name },
  { key: 'role', header: 'Role', cell: (contact) => contact.role },
  { key: 'email', header: 'Email address', cell: (contact) => contact.email },
  { key: 'phone', header: 'Phone number', cell: (contact) => contact.phone },
]

const PATH = '/v1/settings/'

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
  return (
    <div className="admin-stack">
      <PageHeader title="Settings" summary="Values your reports and your vendor depend on. Each change is kept as a new version with its reason." />
      <section className="admin-section" aria-labelledby="thresholds-title">
        <h2 id="thresholds-title" className="admin-section-title">Compliance thresholds</h2>
        <Banner tone="info" title="No thresholds are set for you">
          The product ships no default values. While a threshold is not set, reports leave out the indicator that needs it and say so. Agree each value with your compliance adviser or counsel.
        </Banner>
        <ul className="admin-cards">
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
              <ul className="admin-plain-list">{Object.entries(value).map(([name, threshold]) => <li key={name}>{name}: {volume(threshold)}</li>)}</ul>
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
      <section className="admin-section" aria-labelledby="breach-title">
        <div className="admin-toolbar">
          <h2 id="breach-title" className="admin-section-title">Breach-notification contacts</h2>
          {!readOnly && contacts.data !== null && <Button onClick={() => setEditing('privacy.breach_contacts')}>{contactList === null ? 'Add contacts' : 'Change contacts'}</Button>}
        </div>
        {contacts.error !== null && <LoadFailure error={contacts.error} onRetry={contacts.reload} section />}
        {contacts.data !== null && contactList === null && (
          <Banner tone="warning" title="No breach contact recorded">
            Go-live and the first data load are blocked until at least one contact is recorded.
          </Banner>
        )}
        {(contacts.loading || contactList !== null) && (
          <Table
            caption="People to notify when personal data may have been breached"
            columns={CONTACT_COLUMNS}
            rows={contactList ?? []}
            rowKey={(contact) => `${contact.email}|${contact.name}`}
            loading={contacts.loading}
            empty={{ title: 'No contacts.' }}
          />
        )}
      </section>
      {editing === 'compliance.active_pv_minor' && <ActivePvDialog {...dialog} title="Active earner threshold" current={activePv.data?.value as string | null} />}
      {editing === 'compliance.rank_thresholds_pv_minor' && <RankThresholdsDialog {...dialog} title="Rank thresholds" current={ranks.data?.value as Record<string, string> | null} />}
      {editing === 'compliance.late_order_day' && <LateOrderDayDialog {...dialog} title="Late-order day" current={lateDay.data?.value as number | null} />}
      {editing === 'compliance.personal_share_flag' && <PersonalShareDialog {...dialog} title="Personal-use flag" current={share.data?.value as PersonalShare | null} />}
      {editing === 'privacy.breach_contacts' && <BreachContactsDialog {...dialog} title="Breach-notification contacts" current={contactList} />}
    </div>
  )
}
