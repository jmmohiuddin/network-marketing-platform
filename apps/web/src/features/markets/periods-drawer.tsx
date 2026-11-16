'use client'

import { DataTable } from '../../components/data-table'
import { Drawer } from '../../components/drawer'
import { StatusBadge } from '../../components/status-badge'
import { tableError, usePagedList } from '../admin/resource'
import { NOTE } from '../admin/ui'
import { localBound } from './format'
import type { Calendar, Period } from './types'

/** GET /v1/calendars/:id/periods, ascending; bounds in the calendar's cut-off time zone (local midnight). */
function PeriodsTable({ calendar }: { readonly calendar: Calendar }) {
  const periods = usePagedList<Period>(`/v1/calendars/${calendar.id}/periods`)
  const zone = calendar.cutoff_time_zone
  return (
    <DataTable
      caption={`Periods of ${calendar.name}`}
      density="compact"
      columns={[
        { key: 'starts', header: 'Starts', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm">{localBound(row.starts_at, zone)}</span> },
        { key: 'ends', header: 'Ends', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm">{localBound(row.ends_at, zone)}</span> },
        { key: 'state', header: 'State', cell: (row) => <StatusBadge state={row.state} /> },
      ]}
      rows={periods.rows}
      rowKey={(row) => row.id}
      loading={periods.loading}
      error={tableError(periods)}
      empty={{ title: 'No periods generated yet' }}
      pagination={periods.pagination}
    />
  )
}

export function PeriodsDrawer({ calendar, onClose }: { readonly calendar: Calendar; readonly onClose: () => void }) {
  return (
    <Drawer open onClose={onClose} title={`Periods of ${calendar.name}`} description={`${calendar.market.code} · ${calendar.cadence} · cut-off ${calendar.cutoff_time_zone}`} icon="date_range">
      <p className={NOTE}>Each period runs from its start up to, not including, its end, in local time of {calendar.cutoff_time_zone}.</p>
      <PeriodsTable calendar={calendar} />
    </Drawer>
  )
}
