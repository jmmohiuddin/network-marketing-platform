import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import type { AuthContext } from '../../lib/auth.js'
import { ApiError, notFound, permissionDenied } from '../../lib/errors.js'
import { LIST_NAMES, LISTS, type ListName } from './definitions.js'

// D-B6-08 saved views (FR-RPT-002, PLAN B6 2.4): per user and list, shareable within a role the owner holds whose
// permissions include the list's read permission; read-only for the role's holders.

export const SAVED_VIEWS_PER_USER_LIST = 50
const NAME_TAKEN = 'saved_view_tenant_id_user_id_list_name_key'

export const viewBody = z.strictObject({
  list: z.enum(LIST_NAMES),
  name: z.string().trim().min(1).max(100),
  filters: z.record(z.string(), z.unknown()),
  columns: z.array(z.string().max(64)).min(1).max(40),
  sort: z.string().min(1).max(40),
  is_default: z.boolean().default(false),
  shared_role_id: z.uuid().nullable().default(null),
})
export type ViewBody = z.infer<typeof viewBody>

const invalid = (path: string, message: string) => new ApiError(422, 'VALIDATION_FAILED', message, { path })

/** 403 unless the caller holds the list's read permission. */
export function assertListReader(auth: AuthContext, list: ListName): void {
  if (!auth.permissions.has(LISTS[list].permission)) throw permissionDenied()
}

/** The body against the list's registry (422 VALIDATION_FAILED {path}) and the share target (422 ROLE_NOT_SHAREABLE). */
function validate(auth: AuthContext, body: ViewBody): void {
  const list = LISTS[body.list]
  const filters = list.filters.safeParse(body.filters)
  if (!filters.success) throw invalid(['filters', ...filters.error.issues[0]!.path].join('.'), 'A filter is not valid for this list.')
  const known = new Set(list.columns.map((column) => column.key))
  body.columns.forEach((column, index) => {
    if (!known.has(column) || body.columns.indexOf(column) !== index) throw invalid(`columns.${index}`, 'A column is unknown or repeated.')
  })
  if (!(list.sorts as readonly string[]).includes(body.sort)) throw invalid('sort', 'The sort is not a sort of this list.')
  if (body.shared_role_id === null) return
  const role = auth.roles.find((grant) => grant.roleId === body.shared_role_id)
  if (role === undefined || !role.permissions.includes(list.permission)) {
    throw new ApiError(422, 'ROLE_NOT_SHAREABLE', 'Share a view only within a role you hold that can read this list.')
  }
}

const SELECT = `
  SELECT v.id, v.list, v.name, v.filters, v.columns, v.sort, v.is_default,
         CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id', r.id, 'name', r.name) END AS shared_role,
         jsonb_build_object('id', u.id, 'display_name', u.display_name) AS owner, v.user_id = app_user_id() AS mine
  FROM saved_view v JOIN user_account u ON u.id = v.user_id LEFT JOIN role r ON r.id = v.shared_role_id`

/**
 * GET /v1/saved-views: the caller's views of the list, then those shared to a role the caller holds.
 * shortcut: not paged (own views are capped at SAVED_VIEWS_PER_USER_LIST); page when shared views of a role pass a page.
 */
export async function listViews(tx: Tx, auth: AuthContext, list: ListName) {
  const { rows } = await tx.query(
    `${SELECT} WHERE v.list = $1 AND (v.user_id = app_user_id() OR v.shared_role_id = ANY ($2::uuid[]))
     ORDER BY v.user_id = app_user_id() DESC, v.name, v.id`,
    [list, auth.roles.map((role) => role.roleId)],
  )
  return rows
}

async function viewOf(tx: Tx, id: string) {
  const { rows } = await tx.query(`${SELECT} WHERE v.id = $1`, [id])
  return rows[0]!
}

const audited = (tx: Tx, action: string, id: string, view: { list: string; name: string; shared_role_id: string | null }, extra = {}) =>
  recordAudit(tx, { action, objectType: 'saved_view', objectId: id, after: { list: view.list, name: view.name, shared_role_id: view.shared_role_id, ...extra } })

/** One default per user and list: the previous default stops being one (audited). */
async function clearDefault(tx: Tx, list: string, keep: string | null): Promise<void> {
  const { rows } = await tx.query<{ id: string; list: string; name: string; shared_role_id: string | null }>(
    `UPDATE saved_view SET is_default = false, updated_at = now()
     WHERE user_id = app_user_id() AND list = $1 AND is_default AND id IS DISTINCT FROM $2 RETURNING id, list, name, shared_role_id`,
    [list, keep],
  )
  for (const row of rows) await audited(tx, 'SAVED_VIEW.UPDATED', row.id, row, { is_default: false })
}

const nameTaken = (error: unknown): never => {
  if ((error as { constraint?: string }).constraint === NAME_TAKEN) throw new ApiError(409, 'VIEW_NAME_TAKEN', 'You already have a view with this name.')
  throw error
}

export async function createView(tx: Tx, auth: AuthContext, body: ViewBody) {
  assertListReader(auth, body.list)
  validate(auth, body)
  // The insert guard's lock (0603), taken before the count so concurrent creates at the limit answer 422, not 23514.
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('saved_view:' || app_user_id() || ':' || $1, 0))`, [body.list])
  const { rows: count } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM saved_view WHERE user_id = app_user_id() AND list = $1', [body.list])
  if (count[0]!.n >= SAVED_VIEWS_PER_USER_LIST) {
    throw new ApiError(422, 'VIEW_LIMIT', `You can keep at most ${SAVED_VIEWS_PER_USER_LIST} views per list.`)
  }
  if (body.is_default) await clearDefault(tx, body.list, null)
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO saved_view (tenant_id, user_id, list, name, filters, columns, sort, is_default, shared_role_id)
     VALUES (app_tenant_id(), app_user_id(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [body.list, body.name, body.filters, body.columns, body.sort, body.is_default, body.shared_role_id],
  ).catch(nameTaken)
  const id = rows[0]!.id
  await audited(tx, 'SAVED_VIEW.CREATED', id, body)
  return viewOf(tx, id)
}

/** The caller's own view (others' and unknown ids are 404), after the list permission check. */
async function ownView(tx: Tx, auth: AuthContext, id: string): Promise<{ list: ListName; name: string; shared_role_id: string | null }> {
  const { rows } = await tx.query<{ list: ListName; name: string; shared_role_id: string | null }>(
    'SELECT list, name, shared_role_id FROM saved_view WHERE id = $1 AND user_id = app_user_id() FOR UPDATE', [id])
  if (rows[0] === undefined) throw notFound()
  assertListReader(auth, rows[0].list)
  return rows[0]
}

export async function updateView(tx: Tx, auth: AuthContext, id: string, body: ViewBody) {
  const current = await ownView(tx, auth, id)
  if (body.list !== current.list) throw invalid('list', 'A view stays on its list.')
  validate(auth, body)
  if (body.is_default) await clearDefault(tx, body.list, id)
  await tx.query(
    `UPDATE saved_view SET name = $2, filters = $3, columns = $4, sort = $5, is_default = $6, shared_role_id = $7, updated_at = now() WHERE id = $1`,
    [id, body.name, body.filters, body.columns, body.sort, body.is_default, body.shared_role_id],
  ).catch(nameTaken)
  await audited(tx, 'SAVED_VIEW.UPDATED', id, body)
  return viewOf(tx, id)
}

export async function deleteView(tx: Tx, auth: AuthContext, id: string): Promise<void> {
  const current = await ownView(tx, auth, id)
  await tx.query('DELETE FROM saved_view WHERE id = $1', [id])
  await audited(tx, 'SAVED_VIEW.DELETED', id, current)
}
