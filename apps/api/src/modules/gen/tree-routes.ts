import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireAllMarkets, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { decodeCursor, encodeCursor, pageQuery } from '../../lib/pagination.js'
import { instant, instantMs, toInstant } from './dates.js'
import { loadNodes, type View } from './nodes.js'
import { KINDS, modelState, modelVersionFor, readModelMeta, type Kind } from './read-model.js'
import { breadcrumbs, childrenPage, resolvePosition, searchPositions, type ChildCursor } from './tree.js'

const POSITION_KEY = z.string().trim().min(1).max(64)
export const childCursor = z.tuple([z.string(), z.uuid()])

const treeQuery = z.object({
  kind: z.enum(KINDS).default('sponsor'),
  root: POSITION_KEY.optional(),
  as_of: instant.optional(),
  known_at: z.iso.datetime({ offset: true }).optional(),
  ...pageQuery,
})
const searchQuery = z.object({ kind: z.enum(KINDS).default('sponsor'), q: z.string().trim().min(1).max(100) })

/** Staff genealogy reads need genealogy.read for all markets (D-B2-21). */
export const genealogyReader = [requireRealm('tenant'), requirePermission('genealogy.read'), requireAllMarkets('genealogy.read')]

const invalid = (message: string): ApiError => new ApiError(422, 'VALIDATION_FAILED', message)

/** A page size within GENEALOGY_PAGE_MAX (D-B2-19). */
export const pageLimit = (request: FastifyRequest, limit: number): number => Math.min(limit, request.server.config.genealogyPageMax)

export const nextCursor = (last: ChildCursor | null, more: boolean): string | null =>
  more && last !== null ? encodeCursor(last) : null

function asOfView(query: z.infer<typeof treeQuery>): Pick<View, 'asOf' | 'knownAt'> {
  if (query.known_at !== undefined && query.as_of === undefined) throw invalid('known_at needs as_of.')
  if (query.known_at !== undefined && instantMs(query.known_at) > Date.now()) throw invalid('known_at cannot be in the future.')
  return { asOf: query.as_of === undefined ? null : toInstant(query.as_of), knownAt: query.known_at ?? null }
}

/**
 * API-14: the read model when it is current and neither as_of nor known_at is given; otherwise the system of record
 * with the bitemporal predicate. One level of children per page.
 */
async function tree(tx: Tx, request: FastifyRequest, query: z.infer<typeof treeQuery>) {
  const times = asOfView(query)
  const root = query.root === undefined ? null : await resolvePosition(tx, query.root)
  if (query.root !== undefined && root === null) throw notFound()
  const state = await modelState(tx, query.kind)
  const historical = times.asOf !== null
  const modelVersion = historical ? null : await modelVersionFor(tx, query.kind, state, root)
  const view: View = { kind: query.kind, ...times, modelVersion }
  const limit = pageLimit(request, query.limit)
  const page = await childrenPage(tx, view, root, decodeCursor(query.cursor, childCursor), limit)
  const crumbs = root === null ? { ids: [], truncated: false } : await breadcrumbs(tx, view, root)
  const nodes = await loadNodes(tx, [...(root === null ? [] : [root]), ...crumbs.ids, ...page.ids], view)
  const byId = new Map(nodes.map((node) => [node.position_id, node]))
  const pick = (ids: readonly string[]) => ids.flatMap((id) => byId.get(id) ?? [])
  return envelope(
    {
      focus: root === null ? null : (byId.get(root) ?? null),
      breadcrumbs: pick(crumbs.ids),
      breadcrumbs_truncated: crumbs.truncated,
      children: pick(page.ids),
    },
    { next_cursor: nextCursor(page.last, page.more), read_model: readModelMeta(state, modelVersion !== null) },
  )
}

async function search(tx: Tx, kind: Kind, q: string) {
  const state = await modelState(tx, kind)
  const view: View = { kind, asOf: null, knownAt: null, modelVersion: state.current ? state.version : null }
  const nodes = await loadNodes(tx, await searchPositions(tx, q), view)
  return envelope(nodes, { read_model: readModelMeta(state, view.modelVersion !== null) })
}

export function registerTreeRoutes(app: FastifyInstance): void {
  app.get('/v1/genealogy/tree', { preHandler: genealogyReader }, async (request) => {
    const query = parse(treeQuery, request.query)
    return inTenant(request, (tx) => tree(tx, request, query))
  })

  app.get('/v1/genealogy/search', { preHandler: genealogyReader }, async (request) => {
    const query = parse(searchQuery, request.query)
    return inTenant(request, (tx) => search(tx, query.kind, query.q))
  })
}
