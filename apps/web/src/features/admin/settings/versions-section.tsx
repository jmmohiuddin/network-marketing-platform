'use client'

import { useId } from 'react'
import { Button } from '../../../components/button'
import { DataTable, type DataTableColumn } from '../../../components/data-table'
import { Icon } from '../../../components/icon'
import { useModalDialog } from '../../../components/modal'
import { LoadingState } from '../../../components/states'
import { StatusBadge } from '../../../components/status-badge'
import { useResource } from '../../../lib/use-resource'
import { formatDateTime } from '../format'
import { LoadFailure } from '../page-states'
import { tableError, usePagedList } from '../resource'
import { NOTE, SectionTitle } from '../ui'
import { approvalOf, keyLabel, valueText } from './labels'
import type { StructureEntry, StructurePart, VersionChange, VersionDetail, VersionSummary } from './types'

export const VERSIONS_PATH = '/v1/settings/versions'

/** In force / scheduled / superseded by a rebase / an earlier version (D-B1-01 chain). */
export function versionState(row: VersionSummary, inForce: number | null, now: number): { state: string; label: string } {
  if (row.superseded_by_version !== null) return { state: 'superseded', label: `Superseded by version ${row.superseded_by_version}` }
  if (row.version === inForce) return { state: 'active', label: 'In force' }
  if (Date.parse(row.effective_from) > now) return { state: 'scheduled', label: 'Scheduled' }
  return { state: 'ended', label: 'Earlier version' }
}

const nameOf = (person: { readonly display_name: string | null }) => person.display_name ?? 'Another user'

/** "Dana Doe (DPO)": the approver and the role the changed keys needed (BUG-074: not every approver is Finance). */
function approverText(approver: { readonly display_name: string | null }, keys: readonly { readonly key: string }[]): string {
  const role = keys.map((change) => approvalOf(change.key)).find((approval) => approval !== null)?.role
  return role === undefined ? nameOf(approver) : `${nameOf(approver)} (${role})`
}

function columns(inForce: number | null, now: number, onInspect: (version: number) => void): DataTableColumn<VersionSummary>[] {
  return [
    { key: 'version', header: 'Version', cell: (row) => <span className="font-data-mono-md text-data-mono-md text-on-surface font-semibold">{row.version}</span> },
    { key: 'effective', header: 'Effective from', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm text-on-surface">{formatDateTime(row.effective_from)}</span> },
    { key: 'state', header: 'Status', cell: (row) => <StatusBadge {...versionState(row, inForce, now)} /> },
    { key: 'author', header: 'Author', cell: (row) => nameOf(row.created_by) },
    { key: 'approver', header: 'Approver', cell: (row) => (row.approval === null ? <span className="text-secondary">Not needed</span> : approverText(row.approval.approver, row.changed)) },
    {
      key: 'reason',
      header: 'Reason and changes',
      cell: (row) => (
        <div className="flex flex-col gap-0.5 min-w-48">
          <span className="text-on-surface">{row.reason}</span>
          <span className="text-secondary">{row.changed.map((change) => keyLabel(change.key)).join(', ')}</span>
        </div>
      ),
    },
    {
      key: 'inspect',
      header: 'Inspection',
      align: 'end',
      cell: (row) => <Button size="sm" aria-label={`View diff of version ${row.version}`} onClick={() => onInspect(row.version)}>View diff</Button>,
    },
  ]
}

const entryName = (entry: StructureEntry) => String(entry.code ?? entry.name ?? entry.id)
const PART_LABELS = { markets: 'Markets', brands: 'Brands', calendars: 'Calendars' } as const

/** "Markets added: FR" lines for a structure change (D-B1-02). */
export function structureLines(change: Record<keyof typeof PART_LABELS, StructurePart>): string[] {
  return (Object.keys(PART_LABELS) as (keyof typeof PART_LABELS)[]).flatMap((part) => {
    const { added, removed, changed } = change[part]
    return [
      ...(added.length > 0 ? [`${PART_LABELS[part]} added: ${added.map(entryName).join(', ')}`] : []),
      ...(changed.length > 0 ? [`${PART_LABELS[part]} changed: ${changed.map((item) => entryName(item.after)).join(', ')}`] : []),
      ...(removed.length > 0 ? [`${PART_LABELS[part]} removed: ${removed.map(entryName).join(', ')}`] : []),
    ]
  })
}

/** sc_29 drawer diff item: key, CHANGED chip, before (struck through) and after. */
function DiffItem({ change }: { readonly change: VersionChange }) {
  return (
    <li className="p-space-md rounded bg-surface-container-low space-y-space-xs">
      <div className="flex items-center justify-between gap-space-sm">
        <span className="font-body-sm text-body-sm font-semibold text-on-surface">{keyLabel(change.key)}</span>
        <span className="px-1.5 py-0.5 rounded bg-surface-container font-data-mono-sm text-data-mono-sm text-primary">Changed</span>
      </div>
      {'redacted' in change && <p className={NOTE}>The values are hidden: your role may not read this setting.</p>}
      {'markets' in change && (
        <ul className="pt-1 flex flex-col gap-1 font-data-mono-sm text-data-mono-sm text-on-surface">
          {structureLines(change).map((line) => <li key={line} className="p-2 rounded bg-surface-container-lowest">{line}</li>)}
        </ul>
      )}
      {'before' in change && (
        <div className="grid grid-cols-2 gap-space-sm pt-1">
          <div className="p-2 rounded bg-surface-container-lowest text-secondary line-through font-data-mono-sm text-data-mono-sm break-words">
            <span className="sr-only">Before: </span>{valueText(change.key, change.before)}
          </div>
          <div className="p-2 rounded bg-tertiary-container/15 text-tertiary font-data-mono-sm text-data-mono-sm font-semibold break-words">
            <span className="sr-only">After: </span>{valueText(change.key, change.after)}
          </div>
        </div>
      )}
    </li>
  )
}

function DiffBody({ detail }: { readonly detail: VersionDetail }) {
  return (
    <>
      <div className="p-space-md rounded bg-surface-container space-y-2">
        <div className="flex items-center justify-between font-caption text-caption text-secondary">
          <span>Saved</span>
          <span className="font-data-mono-sm">{formatDateTime(detail.created_at)}</span>
        </div>
        <dl className="grid grid-cols-2 gap-2 font-body-sm text-body-sm">
          <div><dt className="text-secondary text-caption">Author</dt><dd className="font-medium text-on-surface">{nameOf(detail.created_by)}</dd></div>
          <div>
            <dt className="text-secondary text-caption">Approver</dt>
            <dd className="font-medium text-tertiary">{detail.approval === null ? 'Not needed' : `${approverText(detail.approval.approver, detail.changes)}, ${formatDateTime(detail.approval.decided_at)}`}</dd>
          </div>
          <div><dt className="text-secondary text-caption">Effective from</dt><dd className="font-medium text-on-surface">{formatDateTime(detail.effective_from)}</dd></div>
        </dl>
        <div className="pt-2">
          <span className="text-secondary block text-caption">Reason</span>
          <p className="font-body-sm text-body-sm text-on-surface mt-0.5">{detail.reason}</p>
        </div>
      </div>
      <div className="space-y-space-sm">
        <h3 className="font-section-heading text-section-heading text-on-surface font-semibold">Changes against the version before</h3>
        <ul className="flex flex-col gap-space-sm">{detail.changes.map((change) => <DiffItem key={change.key} change={change} />)}</ul>
      </div>
    </>
  )
}

/** sc_29 "Parameter diff inspector" drawer (md:w-[540px] lg:w-[600px]) for one version from GET /v1/settings/versions/:v. */
export function DiffDrawer({ version, onClose }: { readonly version: number; readonly onClose: () => void }) {
  const dialog = useModalDialog(true, onClose)
  const titleId = useId()
  const detail = useResource<VersionDetail>(`${VERSIONS_PATH}/${version}`)
  return (
    <dialog
      ref={dialog.ref}
      aria-labelledby={titleId}
      aria-modal="true"
      onKeyDown={dialog.onKeyDown}
      onCancel={dialog.onCancel}
      className="fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-full max-w-none md:w-[540px] lg:w-[600px] p-0 bg-surface-container-lowest text-on-surface shadow-2xl backdrop:bg-on-background/40"
    >
      <div className="flex flex-col h-full">
        <div className="p-space-lg bg-surface-container-low flex items-center justify-between gap-space-sm">
          <div className="flex flex-col gap-0.5">
            <span className="font-caption text-caption uppercase tracking-wider text-secondary">Version diff</span>
            <h2 id={titleId} className="font-title-md text-title-md text-on-surface font-semibold">Version {version}</h2>
          </div>
          <button type="button" className="w-8 h-8 rounded bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label="Close panel" title="Close panel" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-space-lg space-y-space-lg">
          {detail.loading && <LoadingState label={`Loading version ${version}`} />}
          {detail.error !== null && <LoadFailure error={detail.error} onRetry={detail.reload} section />}
          {detail.data !== null && <DiffBody detail={detail.data} />}
        </div>
        <div className="p-space-md bg-surface-container-low flex items-center justify-end gap-space-sm">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </dialog>
  )
}

export interface VersionsSectionProps {
  /** The version in force now (GET /v1/settings `version`). */
  readonly inForce: number | null
  readonly now: number
  readonly onInspect: (version: number) => void
}

/** sc_29 section 4: every settings version, newest first, with the reason, author and approver. */
export function VersionsSection({ inForce, now, onInspect }: VersionsSectionProps) {
  const versions = usePagedList<VersionSummary>(VERSIONS_PATH)
  return (
    <section className="bg-surface-container-lowest rounded shadow-sm overflow-hidden" aria-labelledby="versions-title">
      <div className="p-space-lg flex flex-col gap-0.5">
        <SectionTitle id="versions-title" icon="history_edu" title="Versions" />
        <p className={NOTE}>Every change is a new version; earlier versions stay on record. When a change takes effect before a scheduled version, the scheduled version is saved again on top of it (its reason starts with “Rebased”) and the old row shows as superseded.</p>
      </div>
      <DataTable
        bare
        caption="Settings versions"
        density="compact"
        columns={columns(inForce, now, onInspect)}
        rows={versions.rows}
        rowKey={(row) => String(row.version)}
        loading={versions.loading}
        error={tableError(versions)}
        empty={{ title: 'No version is saved yet' }}
        pagination={versions.pagination}
      />
    </section>
  )
}
