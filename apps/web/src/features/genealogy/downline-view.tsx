'use client'

import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useCursorPages } from '../../lib/cursor-pages'
import { countLabel } from '../../lib/format'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { MONO, NOTE } from '../admin/ui'
import { positionBadge } from '../people/format'
import type { Downline, DownlineNode, PositionView } from './types'

/** "Names 2 levels below them; the masked contact of personally sponsored participants is hidden." */
export function policySentence(policy: Downline['policy']): string {
  const levels = policy.named_depth === 1 ? '1 level' : `${policy.named_depth} levels`
  const contact = policy.contact_for_personally_sponsored ? 'shown masked' : 'hidden'
  return `The policy names ${levels} below the distributor; the contact of personally sponsored participants is ${contact}. Deeper levels are shown as counts per level only.`
}

const levelText = (depth: number): string => (depth === 0 ? 'The distributor' : depth === 1 ? '1 level below' : `${depth} levels below`)

/** The fields the policy lets the viewer see of one position (nothing else is in the answer). */
function NodeFacts({ node }: { readonly node: DownlineNode }) {
  const contact = node.contact_masked == null ? [] : Object.values(node.contact_masked)
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-body-md text-body-md font-semibold text-on-surface">{node.display_name ?? 'No name'}</span>
        <span className={`${MONO} text-secondary`}>{node.position_ref}</span>
        <StatusBadge {...positionBadge(node.status)} />
      </div>
      <span className="font-caption text-caption text-secondary">
        {[levelText(node.depth), node.enrolled_on == null ? null : `enrolled ${node.enrolled_on}`, node.external_ref ?? null, node.market_code ?? null].filter(Boolean).join(' · ')}
      </span>
      {contact.length > 0 && <span className={`${MONO} text-secondary`}>{contact.join(' · ')}</span>}
    </div>
  )
}

const AGGREGATE_COLUMNS: readonly DataTableColumn<{ readonly depth: number; readonly count: number }>[] = [
  { key: 'depth', header: 'Level below the distributor', cell: (row) => row.depth },
  { key: 'count', header: 'Positions', align: 'end', cell: (row) => countLabel(row.count, 'position') },
]

export interface DownlineViewProps {
  readonly viewerId: string
  /** The position looked at; the viewer's own position when absent. */
  readonly targetId: string
  readonly onFocus: (id: string) => void
  readonly onStop: () => void
}

/**
 * "View as distributor" (API-13, FR-GEN-006, D-B2-08): the sponsor tree as it is now, filtered by the visibility policy
 * on the server for the chosen distributor position. A position outside their downline is "not found".
 */
export function DownlineView({ viewerId, targetId, onFocus, onStop }: DownlineViewProps) {
  const pages = useCursorPages()
  const viewer = useResource<PositionView>(`/v1/positions/${viewerId}`)
  const downline = useResource<Downline>(`/v1/positions/${targetId}/downline`, { viewer: viewerId, kind: 'sponsor', cursor: pages.cursor })
  const next = typeof downline.meta.next_cursor === 'string' ? downline.meta.next_cursor : null
  const view = downline.data
  const viewerRef = viewer.data?.position_ref ?? 'the chosen distributor'
  return (
    <section aria-labelledby="downline-title" className="flex flex-col gap-space-md" data-testid="downline-view">
      <Banner tone="info" title={`Viewing as ${viewerRef}`} action={<Button icon="close" onClick={onStop}>Stop viewing as distributor</Button>}>
        {view === null ? 'What this distributor may see of their downline, as the sponsor tree is now.' : `${policySentence(view.policy)} ${view.policy.default ? 'No tenant policy is in force yet: the platform safe default applies.' : 'This is your tenant’s approved policy.'}`}
      </Banner>
      <h2 id="downline-title" className="font-section-heading text-section-heading text-on-surface">What {viewerRef} sees</h2>
      {downline.error !== null && (isNotAvailable(downline.error)
        ? <NotAvailable section />
        : <Banner tone="danger" title="The downline could not be loaded" action={<Button onClick={downline.reload}>Try again</Button>}>{errorMessage(downline.error)}</Banner>)}
      {downline.loading && <p className={NOTE} role="status">Loading the downline</p>}
      {view !== null && (
        <>
          {view.node !== null && <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-md"><NodeFacts node={view.node} /></div>}
          <ul className="flex flex-col gap-space-xs" aria-label="Named positions">
            {view.children.map((child) => (
              <li key={child.position_id} className="bg-surface-container-low p-space-sm rounded-xl shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
                <NodeFacts node={child} />
                <Button size="sm" variant="tertiary" aria-label={`Focus ${child.position_ref}`} onClick={() => onFocus(child.position_id)}>Focus</Button>
              </li>
            ))}
          </ul>
          {view.children.length === 0 && <p className={NOTE}>No named position below this one for this distributor.</p>}
          {(next !== null || pages.hasPrevious) && (
            <div className="flex justify-end gap-space-xs">
              <Button size="sm" disabled={!pages.hasPrevious} onClick={pages.previous}>Previous page</Button>
              <Button size="sm" disabled={next === null} onClick={() => next !== null && pages.next(next)}>Next page</Button>
            </div>
          )}
          <DataTable caption="Positions per level beyond the named depth" columns={AGGREGATE_COLUMNS} rows={view.aggregates} rowKey={(row) => String(row.depth)}
            empty={{ title: 'No position beyond the named levels.' }} />
        </>
      )}
    </section>
  )
}
