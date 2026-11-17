'use client'

import { FOCUS_RING } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { StatusBadge } from '../../components/status-badge'
import { countLabel, formatDateTime } from '../../lib/format'
import { NOTE } from '../admin/ui'
import { EvidenceFile } from './gate-inspector'
import { CATEGORY_TABS, ITEM_STATUS, KIND_LABELS } from './format'
import type { ChecklistItem, ProviderRecord } from './types'

/** The "basis / status" cell: what the item rests on besides an evidence file. */
export function basisText(item: ChecklistItem): string {
  const detail = item.detail
  if (detail?.rules !== undefined) {
    const screening = detail.rules.filter((rule) => rule.mandatory && rule.basis_status === 'screening').length
    return `${countLabel(detail.rules.length, 'rule')}${screening > 0 ? `, ${screening} mandatory at screening` : ''}`
  }
  if (detail?.providers !== undefined) return detail.providers.length === 0 ? 'No approval recorded' : detail.providers.map((provider) => provider.provider).join(', ')
  if (detail?.contacts !== undefined) return countLabel(detail.contacts, 'contact')
  if (detail?.region !== undefined) return `Region ${detail.region}`
  if (detail?.version !== undefined) return detail.version === null ? 'No version published' : `Version ${detail.version.label}`
  return item.entry?.note ?? (item.kind === 'evidence' ? 'Evidence document' : '—')
}

/** Who recorded the item and when: its entry, or each provider approval it rests on (BUG-058). */
export function recordsOf(item: ChecklistItem, providers: readonly ProviderRecord[] | null): { readonly by: string; readonly at: string }[] {
  if (item.entry !== null) return [{ by: item.entry.recorded_by.display_name ?? 'Another user', at: item.entry.recorded_at }]
  const ids = new Set(item.detail?.providers?.map((provider) => provider.id) ?? [])
  return (providers ?? []).filter((record) => ids.has(record.id)).map((record) => ({ by: record.created_by.display_name ?? 'Another user', at: record.created_at }))
}

function EvidenceAndRecord({ item, providers }: { readonly item: ChecklistItem; readonly providers: readonly ProviderRecord[] | null }) {
  const records = recordsOf(item, providers)
  if (item.entry?.document == null && records.length === 0) return <span className="text-secondary">—</span>
  return (
    <div className="w-48 flex flex-col gap-1">
      {item.entry !== null && <EvidenceFile entry={item.entry} />}
      {records.map((record) => (
        <span key={`${record.by}:${record.at}`} className="font-caption text-caption text-secondary">Recorded by {record.by}, {formatDateTime(record.at)}</span>
      ))}
    </div>
  )
}

/**
 * sc_17 columns: item, basis, evidence (with who recorded it, as sc_17 captions the signer) and status at the end. The
 * item title is the inspect control (sc_17 rows open the inspector), so the table fits beside it at 1440 (BUG-052).
 */
function columns(onInspect: (item: string) => void, selected: string, providers: readonly ProviderRecord[] | null): DataTableColumn<ChecklistItem>[] {
  return [
    {
      key: 'item',
      header: 'Item',
      cell: (row) => (
        <div className="min-w-40 flex flex-col items-start">
          <button
            type="button"
            id={`gate-${row.item}`}
            aria-current={row.item === selected ? 'true' : undefined}
            onClick={() => onInspect(row.item)}
            className={`text-left font-semibold rounded-sm hover:text-primary hover:underline transition-colors ${FOCUS_RING} ${row.status === 'missing' ? 'text-error' : 'text-on-surface'}`}
          >
            {row.title}
          </button>
          <span className="font-caption text-caption text-on-surface-variant">{KIND_LABELS[row.kind]}</span>
        </div>
      ),
    },
    { key: 'basis', header: 'Basis or detail', cell: (row) => <span className="block w-36">{basisText(row)}</span> },
    { key: 'evidence', header: 'Evidence and record', cell: (row) => <EvidenceAndRecord item={row} providers={providers} /> },
    { key: 'status', header: 'Status', align: 'end', cell: (row) => <StatusBadge {...ITEM_STATUS[row.status]} /> },
  ]
}

export interface GateTableProps {
  readonly items: readonly ChecklistItem[]
  readonly filter: string
  readonly onFilter: (filter: string) => void
  readonly selected: string
  readonly onInspect: (item: string) => void
  /** The market's provider approvals (GET /v1/provider-configs); null until they load. */
  readonly providers: readonly ProviderRecord[] | null
}

/** sc_17 left column: category filter buttons, then the gate table. */
export function GateTable({ items, filter, onFilter, selected, onInspect, providers }: GateTableProps) {
  const tab = CATEGORY_TABS.find((candidate) => candidate.id === filter) ?? CATEGORY_TABS[0]!
  const shown = items.filter((item) => tab.categories.includes(item.category))
  return (
    <section aria-labelledby="gates-title" className="min-[1440px]:col-span-8 min-w-0 flex flex-col bg-surface-container-lowest border border-outline-variant rounded-sm shadow-sm">
      <div className="p-space-sm border-b border-outline-variant flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm bg-surface-container-low">
        <h2 id="gates-title" className="sr-only font-section-heading text-section-heading text-on-surface">Checklist items</h2>
        <div role="group" aria-label="Filter items by category" className="flex flex-wrap items-center gap-1">
          {CATEGORY_TABS.map((candidate) => {
            const count = items.filter((item) => candidate.categories.includes(item.category)).length
            const active = candidate.id === tab.id
            return (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={active}
                onClick={() => onFilter(candidate.id)}
                className={`px-space-sm py-1 rounded font-body-sm text-body-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${active ? 'bg-surface-container-lowest border border-outline-variant text-primary font-semibold shadow-sm' : 'hover:bg-surface-container-high text-on-surface-variant'}`}
              >
                {candidate.label} ({count})
              </button>
            )
          })}
        </div>
      </div>
      <DataTable bare density="compact" caption="Launch checklist items" columns={columns(onInspect, selected, providers)} rows={shown} rowKey={(row) => row.item} selectedKey={selected} empty={{ title: 'No items in this category' }} />
      <div className="p-space-sm border-t border-outline-variant bg-surface-container-low">
        <p className={NOTE}>Every item is mandatory. The market goes live only when each is complete and a Compliance officer who did not prepare it signs off.</p>
      </div>
    </section>
  )
}
