'use client'

import Link from 'next/link'
import { Button, LinkButton } from '../../components/button'
import { Icon } from '../../components/icon'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { formatDateTime } from '../../lib/format'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { LoadFailure } from '../admin/page-states'
import { MONO, NOTE } from '../admin/ui'
import { positionBadge, rangeText } from '../people/format'
import type { PositionView } from './types'

const PANEL = 'bg-surface-container-low p-space-sm rounded-xl flex flex-col gap-1.5'
const PANEL_LABEL = 'font-caption text-caption text-secondary uppercase font-semibold'

/**
 * sc_07 position inspector (right column): owner and the link to their record, status, current parents, ownership and
 * status history; "Request change" opens a genealogy change case (SC-08). As the position is now, not at the as-of date.
 */
export function PositionInspector({ positionId, onFocus }: { readonly positionId: string; readonly onFocus: (id: string) => void }) {
  const { can, readOnly } = useSession()
  const position = useResource<PositionView>(`/v1/positions/${positionId}`)
  const view = position.data
  return (
    <aside aria-labelledby="inspector-title" className="bg-surface-container-lowest rounded-xl shadow-sm p-space-md flex flex-col gap-space-sm">
      <div className="flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-2">
          <Icon name="badge" size={20} className="text-primary" />
          <h2 id="inspector-title" className="font-section-heading text-section-heading font-bold text-on-surface">Position {view?.position_ref ?? ''}</h2>
        </div>
        {view !== null && <span className={`${MONO} bg-surface-container px-2 py-0.5 rounded text-secondary font-medium`}>{view.market.code}</span>}
      </div>
      {position.error !== null && <LoadFailure error={position.error} onRetry={position.reload} section />}
      {position.loading && <LoadingState label="Loading the position" />}
      {view !== null && (
        <>
          <p className={NOTE}>As the position is now.</p>
          <div className={PANEL}>
            <span className={PANEL_LABEL}>Owner</span>
            {view.owner === null
              ? <span className="font-body-md text-body-md text-on-surface">No current owner</span>
              : (
                <div className="flex flex-wrap items-center justify-between gap-space-xs">
                  <span className="font-body-md text-body-md font-bold text-on-surface">{view.owner.display_name ?? view.owner.external_ref}<span className={`${MONO} text-secondary ml-1.5 font-normal`}>{view.owner.external_ref}</span></span>
                  {can('participant.read') && <Link className="font-caption text-caption text-primary font-semibold hover:underline" href={`/people/${view.owner.participant_id}`}>Open participant record</Link>}
                </div>
              )}
          </div>
          <div className={PANEL}>
            <span className={PANEL_LABEL}>Status</span>
            <div className="flex flex-wrap items-center gap-space-xs">
              <StatusBadge {...positionBadge(view.status)} />
              <span className={`${MONO} text-secondary`}>since {formatDateTime(view.status_from)}</span>
            </div>
          </div>
          <div className={PANEL}>
            <span className={PANEL_LABEL}>Parents now</span>
            {(['sponsor', 'placement'] as const).map((kind) => {
              const parent = view.parents[kind]
              return (
                <div key={kind} className="flex flex-wrap items-center justify-between gap-space-xs">
                  <span className="font-body-sm text-body-sm text-on-surface">{kind === 'sponsor' ? 'Sponsor' : 'Placement'}</span>
                  {parent === null
                    ? <span className="font-body-sm text-body-sm text-secondary">None (top of the tree)</span>
                    : (
                      <Button size="sm" variant="tertiary" aria-label={`Focus ${kind} ${parent.position_ref}`} onClick={() => onFocus(parent.position_id)}>
                        {parent.position_ref}{'leg' in parent && parent.leg !== null ? ` · leg ${parent.leg}` : ''}
                      </Button>
                    )}
                </div>
              )
            })}
          </div>
          <div className={PANEL}>
            <span className={PANEL_LABEL}>Owners over time</span>
            <ul className="flex flex-col gap-1">
              {view.ownership.map((entry) => (
                <li key={`${entry.participant.id}|${entry.valid_from}`} className="flex flex-col">
                  <span className="font-body-sm text-body-sm text-on-surface">{entry.participant.display_name ?? entry.participant.external_ref}{entry.case_id === null ? '' : ' (by case)'}</span>
                  <span className={`${MONO} text-secondary`}>{rangeText(entry.valid_from, entry.valid_to, formatDateTime)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className={PANEL}>
            <span className={PANEL_LABEL}>Status history</span>
            <ul className="flex flex-col gap-1">
              {view.status_history.map((entry) => (
                <li key={`${entry.effective_from}|${entry.recorded_at}|${entry.to_status}`} className="flex flex-col">
                  <span className="font-body-sm text-body-sm text-on-surface">{positionBadge(entry.to_status).label} from {formatDateTime(entry.effective_from)}</span>
                  {entry.reason !== null && <span className={NOTE}>{entry.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
          {can('case.genealogy.create') && !readOnly && (
            <LinkButton icon="rule" href="/cases/genealogy/new">Request change</LinkButton>
          )}
        </>
      )}
    </aside>
  )
}
