'use client'

import { useState } from 'react'
import { Banner } from '../../components/banner'
import { Button, FOCUS_RING } from '../../components/button'
import { PaginationBar, type Pagination } from '../../components/data-table'
import { Icon } from '../../components/icon'
import { StatusBadge } from '../../components/status-badge'
import { useCursorPages } from '../../lib/cursor-pages'
import { countLabel, formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { MONO } from '../admin/ui'
import { positionBadge } from '../people/format'
import { TREE_PATH, type ReadModel, type TreeKind, type TreeNode, type TreePage } from './types'

/** The owner's name, else their reference; a position without an owner at the date says so. */
export function nodeName(node: Pick<TreeNode, 'owner'>): string {
  if (node.owner === null) return 'No owner at this date'
  return node.owner.display_name ?? node.owner.external_ref
}

/** "3 direct · 41 in subtree"; the subtree count exists only while the read model answers. */
export function countsText(node: Pick<TreeNode, 'children_count' | 'subtree_count'>): string {
  const direct = `${node.children_count} direct`
  return node.subtree_count === null ? direct : `${direct} · ${countLabel(node.subtree_count, 'position')} in subtree`
}

/** What the tree is read from (D-B2-07): the read model, a stale one being rebuilt, or the system of record by date. */
export function ReadModelBanner({ model, historical }: { readonly model: ReadModel | null; readonly historical: boolean }) {
  if (model === null) return null
  if (model.state === 'stale') {
    return (
      <Banner tone="warning" title="The tree changed and is being rebuilt">
        A change since {formatDateTime(model.stale_since)} is not in the read model yet, so this view is read from the system of record: subtree
        counts are not shown until the rebuild finishes (about a minute).
      </Banner>
    )
  }
  if (historical || model.source === 'system_of_record') {
    return (
      <Banner tone="info" title="Read from the system of record">
        Positions, owners and statuses are shown as they were at the date you chose. Subtree counts exist for the current tree only.
      </Banner>
    )
  }
  return <p className="font-caption text-caption text-secondary" role="status">Read model version {String(model.version)} is current.</p>
}

export interface TreeQuery {
  readonly kind: TreeKind
  readonly as_of?: string
  readonly known_at?: string
}

interface RowsProps {
  readonly nodes: readonly TreeNode[]
  readonly query: TreeQuery
  readonly onFocus: (id: string) => void
}

/** sc_07 frontline row: expand toggle, leg tile, owner, reference, status, counts and Focus. Children load on expand. */
function ChildRow({ node, query, onFocus }: { readonly node: TreeNode; readonly query: TreeQuery; readonly onFocus: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const name = nodeName(node)
  return (
    <li className="flex flex-col gap-space-xs">
      <div className="bg-surface-container-low hover:bg-surface-container p-space-sm rounded-xl transition-colors shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm min-w-0">
          {node.children_count > 0
            ? (
              <button type="button" className={`w-6 h-6 shrink-0 rounded bg-surface-container-lowest hover:bg-primary hover:text-on-primary text-secondary flex items-center justify-center transition-colors shadow-sm ${FOCUS_RING}`}
                aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} the ${node.children_count} positions under ${node.position_ref}`} title={`${open ? 'Hide' : 'Show'} positions under ${node.position_ref}`}
                onClick={() => setOpen((value) => !value)}>
                <Icon name={open ? 'arrow_drop_down' : 'arrow_right'} size={16} />
              </button>
            )
            : <span className="w-6 h-6 shrink-0" aria-hidden="true" />}
          {node.leg !== null && (
            <span className="w-8 h-8 shrink-0 rounded-lg bg-surface-container-lowest flex items-center justify-center font-data-mono-sm text-data-mono-sm font-bold text-primary shadow-sm" title={`Leg ${node.leg}`}>
              <span className="sr-only">Leg </span>{node.leg}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-body-md text-body-md font-semibold text-on-surface break-words">{name}</span>
              <span className={`${MONO} text-secondary font-medium`}>{node.position_ref}</span>
              <StatusBadge {...positionBadge(node.status)} />
              <span className="px-2 py-0.5 rounded bg-surface-container-lowest text-secondary font-caption text-caption shadow-sm">{node.market_code}</span>
            </div>
            <p className="font-caption text-caption text-secondary mt-0.5">{countsText(node)}</p>
          </div>
        </div>
        <Button size="sm" variant="tertiary" className="self-end md:self-center" aria-label={`Focus ${node.position_ref}`} onClick={() => onFocus(node.position_id)}>Focus</Button>
      </div>
      {open && (
        <div className="pl-space-lg border-l-2 border-outline-variant ml-3">
          <ChildList rootId={node.position_id} query={query} onFocus={onFocus} />
        </div>
      )}
    </li>
  )
}

/** One level of positions (lazy: nothing below is read until expanded). */
export function ChildRows({ nodes, query, onFocus, pagination, label }: RowsProps & { readonly pagination: Pagination; readonly label: string }) {
  return (
    <div className="flex flex-col gap-space-xs">
      <ul className="flex flex-col gap-space-xs" aria-label={label}>
        {nodes.map((node) => <ChildRow key={node.position_id} node={node} query={query} onFocus={onFocus} />)}
      </ul>
      {(pagination.hasNext || pagination.hasPrevious) && <div className="rounded overflow-hidden"><PaginationBar label={`Pages of ${label.toLowerCase()}`} pagination={pagination} /></div>}
    </div>
  )
}

/** The children of one expanded position, one page at a time (API-14 with that root). */
function ChildList({ rootId, query, onFocus }: { readonly rootId: string; readonly query: TreeQuery; readonly onFocus: (id: string) => void }) {
  const pages = useCursorPages()
  const page = useResource<TreePage>(TREE_PATH, { ...query, root: rootId, cursor: pages.cursor })
  const next = typeof page.meta.next_cursor === 'string' ? page.meta.next_cursor : null
  if (page.error !== null) {
    return (
      <div className="flex items-center gap-space-sm" role="alert">
        <span className="font-body-sm text-body-sm text-on-surface">{errorMessage(page.error)}</span>
        <Button size="sm" onClick={page.reload}>Try again</Button>
      </div>
    )
  }
  if (page.data === null) return <p className="font-caption text-caption text-secondary" role="status">Loading positions</p>
  const focusRef = page.data.focus?.position_ref ?? ''
  return (
    <ChildRows nodes={page.data.children} query={query} onFocus={onFocus} label={`Positions under ${focusRef}`}
      pagination={{ hasPrevious: pages.hasPrevious, hasNext: next !== null, onPrevious: pages.previous, onNext: () => next !== null && pages.next(next) }} />
  )
}
