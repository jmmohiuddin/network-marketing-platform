'use client'

import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Button, FOCUS_RING } from '../../components/button'
import { TextInput } from '../../components/form-field'
import { Icon } from '../../components/icon'
import { PageHeader } from '../../components/page-header'
import { SegmentedControl } from '../../components/segmented-control'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useCursorPages } from '../../lib/cursor-pages'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { fromLocalInput } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { MONO, NOTE } from '../admin/ui'
import { positionBadge } from '../people/format'
import { useQueryParams } from '../people/url'
import { DownlineView } from './downline-view'
import { PositionInspector } from './inspector'
import { ChildRows, countsText, nodeName, ReadModelBanner, type TreeQuery } from './tree-list'
import { SEARCH_PATH, TREE_PATH, type ReadModel, type TreeKind, type TreeNode, type TreePage } from './types'

const KINDS = [{ value: 'sponsor', label: 'Sponsor tree', icon: 'share' }, { value: 'placement', label: 'Placement tree', icon: 'grid_view' }] as const
const AS_OF = /^\d{4}-\d{2}-\d{2}$/

export interface ExplorerParams {
  readonly kind: TreeKind
  readonly root: string | null
  readonly asOf: string
  readonly knownAt: string
  readonly viewer: string | null
}

/** The API query of the explorer's URL state, or the problem with the dates (known-at needs as-of; never the future). */
export function treeQueryOf(params: ExplorerParams, now: number = Date.now()): { readonly query: TreeQuery; readonly problem: string | null } {
  const base = { kind: params.kind }
  if (params.asOf !== '' && !AS_OF.test(params.asOf)) return { query: base, problem: 'Enter the as-of date as a date.' }
  if (params.knownAt === '') return { query: params.asOf === '' ? base : { ...base, as_of: params.asOf }, problem: null }
  if (params.asOf === '') return { query: base, problem: 'Choose an as-of date first: known-at looks back at what was recorded about that date.' }
  const knownAt = fromLocalInput(params.knownAt)
  if (knownAt === null) return { query: { ...base, as_of: params.asOf }, problem: 'Enter a valid known-at date and time.' }
  if (Date.parse(knownAt) > now) return { query: { ...base, as_of: params.asOf }, problem: 'Known-at cannot be in the future.' }
  return { query: { ...base, as_of: params.asOf, known_at: knownAt }, problem: null }
}

/** Search by position reference prefix, external reference or name (API search, at most 20). */
function PositionSearch({ kind, label, actionLabel, onPick }: { readonly kind: TreeKind; readonly label: string; readonly actionLabel: string; readonly onPick: (node: TreeNode) => void }) {
  const api = useApi()
  const [text, setText] = useState('')
  const [results, setResults] = useState<readonly TreeNode[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (text.trim() === '') {
      setProblem('Enter a reference or a name.')
      return
    }
    setProblem(null)
    try {
      setResults((await api.get<TreeNode[]>(SEARCH_PATH, { query: { kind, q: text.trim() } })).data)
    } catch (error) {
      setResults(null)
      setProblem(errorMessage(error))
    }
  }
  return (
    <div className="flex flex-col gap-space-xs">
      <form role="search" className="flex items-end gap-space-xs" onSubmit={search}>
        <div className="flex-1 min-w-0">
          <TextInput label={label} icon="search" type="search" maxLength={100} placeholder="Position, external reference or name" value={text} error={problem} onChange={(event) => setText(event.target.value)} />
        </div>
        <Button type="submit">Search</Button>
      </form>
      {results !== null && (results.length === 0
        ? <p className={NOTE} role="status">No position matches.</p>
        : (
          <ul className="flex flex-col gap-1" aria-label="Search results">
            {results.map((node) => (
              <li key={node.position_id} className="flex flex-wrap items-center justify-between gap-space-xs bg-surface-container-lowest p-2 rounded shadow-sm">
                <span className="font-body-sm text-body-sm text-on-surface">{nodeName(node)} <span className={`${MONO} text-secondary`}>{node.position_ref}</span></span>
                <Button size="sm" aria-label={`${actionLabel} ${node.position_ref}`} onClick={() => { setResults(null); onPick(node) }}>{actionLabel}</Button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}

/** sc_07 breadcrumbs to the root: buttons that refocus, the focused position last. */
function Crumbs({ page, onFocus }: { readonly page: TreePage; readonly onFocus: (id: string | null) => void }) {
  const crumb = `hover:text-primary transition-colors flex items-center gap-1 font-medium rounded ${FOCUS_RING}`
  return (
    <nav aria-label="Path to the top of the tree" className="bg-surface-container-lowest p-space-sm rounded-xl shadow-sm">
      <ol className="flex items-center gap-1.5 font-body-sm text-body-sm text-secondary flex-wrap">
        <li><button type="button" className={crumb} onClick={() => onFocus(null)}><Icon name="domain" size={16} />Top level</button></li>
        {page.breadcrumbs_truncated && <li aria-label="Levels not shown">…</li>}
        {page.breadcrumbs.map((node) => (
          <li key={node.position_id} className="flex items-center gap-1.5">
            <Icon name="chevron_right" size={14} className="text-outline" />
            <button type="button" className={crumb} onClick={() => onFocus(node.position_id)}>{nodeName(node)}<span className={`${MONO} text-outline`}>({node.position_ref})</span></button>
          </li>
        ))}
        {page.focus !== null && (
          <li className="flex items-center gap-1.5">
            <Icon name="chevron_right" size={14} className="text-outline" />
            <span aria-current="location" className="font-semibold text-primary flex items-center gap-1 bg-surface-container px-2 py-0.5 rounded">
              {nodeName(page.focus)}<span className={`${MONO} text-secondary`}>({page.focus.position_ref})</span>
            </span>
          </li>
        )}
      </ol>
    </nav>
  )
}

/** sc_07 focused node card, with a flat header (no gradient on work screens). */
function FocusCard({ node }: { readonly node: TreeNode }) {
  return (
    <section aria-labelledby="focus-title" className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden" data-testid="focus-node">
      <div className="bg-primary px-space-md py-space-sm text-on-primary flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 id="focus-title" className="font-title-md text-title-md font-bold tracking-tight break-words">{nodeName(node)}</h2>
            <span className="font-data-mono-sm text-data-mono-sm bg-surface-container-lowest/20 px-2 py-0.5 rounded font-medium">{node.position_ref}</span>
          </div>
          <p className="font-caption text-caption text-primary-fixed mt-0.5">{[node.owner?.external_ref, node.market_code, node.leg === null ? null : `leg ${node.leg}`].filter(Boolean).join(' · ')}</p>
        </div>
        <StatusBadge {...positionBadge(node.status)} />
      </div>
      <p className="px-space-md py-space-sm font-body-sm text-body-sm text-secondary">{countsText(node)}</p>
    </section>
  )
}

function TreeView({ params, query, onFocus }: { readonly params: ExplorerParams; readonly query: TreeQuery; readonly onFocus: (id: string | null) => void }) {
  const pages = useCursorPages()
  const page = useResource<TreePage>(TREE_PATH, { ...query, root: params.root ?? undefined, cursor: pages.cursor })
  const next = typeof page.meta.next_cursor === 'string' ? page.meta.next_cursor : null
  const model = (page.meta.read_model ?? null) as ReadModel | null
  if (page.error !== null) return <LoadFailure error={page.error} onRetry={page.reload} section />
  if (page.data === null) return <LoadingState label="Loading the tree" />
  const { data } = page
  const label = data.focus === null ? 'Top-level positions' : `Positions under ${data.focus.position_ref}`
  return (
    <div className="flex flex-col gap-space-md">
      <ReadModelBanner model={model} historical={query.as_of !== undefined} />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-start">
        <div className="lg:col-span-8 flex flex-col gap-space-md min-w-0">
          {data.focus !== null && <Crumbs page={data} onFocus={onFocus} />}
          {data.focus !== null && <FocusCard node={data.focus} />}
          <h2 className="font-section-heading text-section-heading text-on-surface">{label}</h2>
          {data.children.length === 0
            ? <EmptyState title={data.focus === null ? 'No position in this tree at that date.' : 'No position directly under this one at that date.'} />
            : (
              <ChildRows nodes={data.children} query={query} onFocus={onFocus} label={label}
                pagination={{ hasPrevious: pages.hasPrevious, hasNext: next !== null, onPrevious: pages.previous, onNext: () => next !== null && pages.next(next) }} />
            )}
        </div>
        {data.focus !== null && (
          <div className="lg:col-span-4">
            <PositionInspector key={data.focus.position_id} positionId={data.focus.position_id} onFocus={onFocus} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * SC-07 Genealogy explorer (FR-GEN-003/006/007, API-13/14): search-first, sponsor or placement tree, as of a date and as
 * known at a time, one lazily loaded level at a time, and "View as distributor" through the server's visibility policy.
 * State lives in the URL: ?root&kind&asOf&knownAt&viewer.
 */
export function GenealogyExplorer() {
  const [search, update] = useQueryParams()
  const params: ExplorerParams = {
    kind: search.get('kind') === 'placement' ? 'placement' : 'sponsor',
    root: search.get('root'),
    asOf: search.get('asOf') ?? '',
    knownAt: search.get('knownAt') ?? '',
    viewer: search.get('viewer'),
  }
  const [picking, setPicking] = useState(false)
  const { query, problem } = treeQueryOf(params)
  const focus = (id: string | null) => update({ root: id })
  return (
    <>
      <PageHeader
        title="Genealogy"
        summary="Sponsor and placement trees as of any date, read one level at a time. Changes go through genealogy cases."
        actions={params.viewer === null ? <Button icon="visibility" onClick={() => setPicking((value) => !value)} aria-expanded={picking}>View as distributor</Button> : undefined}
      />
      <section aria-label="Explorer settings" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-space-sm bg-surface-container-low p-space-sm rounded-xl">
        <div className="xl:col-span-5">
          <PositionSearch kind={params.kind} label="Find a position" actionLabel="Focus" onPick={(node) => update({ root: node.position_id })} />
        </div>
        <div className="xl:col-span-3">
          <SegmentedControl label="Tree kind" options={KINDS} value={params.kind} onChange={(kind) => update({ kind: kind === 'sponsor' ? null : kind })} />
        </div>
        <div className="xl:col-span-2">
          <TextInput label="As of (valid time)" type="date" value={params.asOf} onChange={(event) => update({ asOf: event.target.value, ...(event.target.value === '' ? { knownAt: null } : {}) })} />
        </div>
        <div className="xl:col-span-2">
          <TextInput label="Known at (recorded)" type="datetime-local" optional value={params.knownAt} error={problem}
            helper="Your local time: what was recorded by then." onChange={(event) => update({ knownAt: event.target.value })} />
        </div>
      </section>
      {picking && params.viewer === null && (
        <section aria-label="Choose the distributor" className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex flex-col gap-space-sm">
          <p className={NOTE}>Shows a distributor’s own downline as the server lets them see it: named levels by the visibility policy, deeper levels as counts only.</p>
          <PositionSearch kind="sponsor" label="Distributor position" actionLabel="View as" onPick={(node) => { setPicking(false); update({ viewer: node.position_id, root: null }) }} />
        </section>
      )}
      {params.viewer !== null
        ? <DownlineView key={`${params.viewer}|${params.root ?? ''}`} viewerId={params.viewer} targetId={params.root ?? params.viewer} onFocus={focus} onStop={() => update({ viewer: null })} />
        : <TreeView key={JSON.stringify([params.root, query])} params={params} query={query} onFocus={focus} />}
    </>
  )
}
