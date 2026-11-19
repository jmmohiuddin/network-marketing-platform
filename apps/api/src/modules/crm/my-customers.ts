import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { assertPortalActive, currentAuth, requirePortal } from '../../lib/auth.js'
import { maskContact, type Contact } from '../../lib/contact.js'
import { inPortal } from '../../lib/db.js'
import { notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { getSetting } from '../ten/index.js'

// D-B5-11 My customers (FR-DIST-005, AC-52.1): the servicing rows whose servicing position the session participant owns
// now; nobody sees another servicer's rows. repeat = 2 or more orders (a definition, not a threshold). The contact
// leaves masked and only while portal.customer_contact_visible is true (unset: hidden). No earnings per customer.

const PAGE_MAX = 50
const LAST_ORDERS = 10

const listQuery = z.strictObject({
  state: z.enum(['current', 'past', 'all']).default('current'),
  repeat: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  sort: z.enum(['name', 'last_order']).default('name'),
  cursor: pageQuery.cursor,
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_MAX),
})
const idParams = z.object({ id: z.uuid() })
// The sort key of the last row: [name, servicing id] or [never ordered, -epoch of the last order, servicing id].
const nameCursor = z.tuple([z.string(), z.uuid()])
const orderCursor = z.tuple([z.boolean(), z.string().regex(/^-?\d+(\.\d+)?$/), z.uuid()])

// $1 participant; the servicing rows of the positions it owns now, with the customer's orders attributed to that
// position. Every list filter applies to this set.
const OWN_ROWS = `
  WITH own AS (
    SELECT s.id AS servicing_id, s.customer_id, s.valid_from, s.valid_to, p.position_ref, s.servicing_position_id
    FROM customer_servicing s
    JOIN position_ownership o ON o.tenant_id = s.tenant_id AND o.position_id = s.servicing_position_id
      AND o.valid_from <= now() AND (o.valid_to IS NULL OR o.valid_to > now())
    JOIN position p ON p.tenant_id = s.tenant_id AND p.id = s.servicing_position_id
    WHERE o.participant_id = $1
  ), rows AS (
    SELECT own.*, c.display_name, c.contact,
      (SELECT max(so.ordered_at) FROM sales_order so WHERE so.buyer_id = own.customer_id AND so.attributed_position_id = own.servicing_position_id) AS last_order_at,
      (SELECT count(*)::int FROM sales_order so WHERE so.buyer_id = own.customer_id AND so.attributed_position_id = own.servicing_position_id) AS order_count
    FROM own JOIN participant c ON c.id = own.customer_id
  )`

interface CustomerRow {
  readonly servicing_id: string
  readonly customer_id: string
  readonly display_name: string | null
  readonly position_ref: string
  readonly servicing_position_id: string
  readonly valid_from: Date
  readonly valid_to: Date | null
  readonly last_order_at: Date | null
  readonly order_count: number
  readonly contact: Contact | null
}

interface ListRow extends CustomerRow {
  readonly sort_none: boolean
  readonly sort_epoch: string
}

const STATE_FILTER = {
  current: 'valid_from <= now() AND (valid_to IS NULL OR valid_to > now())',
  past: 'valid_to <= now()',
  all: 'true',
} as const

async function customerList(tx: Tx, participantId: string, query: z.infer<typeof listQuery>) {
  const byName = query.sort === 'name'
  const nameAfter = byName ? decodeCursor(query.cursor, nameCursor) : undefined
  const orderAfter = byName ? undefined : decodeCursor(query.cursor, orderCursor)
  // Newest order first, never-ordered customers last; the epoch is numeric (node-pg gives text) so the key compares exactly.
  const [keyset, order, key] = byName
    ? [`($4::text IS NULL OR (coalesce(display_name, ''), servicing_id) > ($4, $5::uuid))`,
      `coalesce(display_name, ''), servicing_id`, nameAfter ?? [null, null]]
    : [`($4::boolean IS NULL OR (sort_none, sort_epoch, servicing_id) > ($4, $5::numeric, $6::uuid))`,
      'sort_none, sort_epoch, servicing_id', orderAfter ?? [null, null, null]]
  const { rows } = await tx.query<ListRow>(
    `${OWN_ROWS}, keyed AS (
       SELECT *, last_order_at IS NULL AS sort_none, -extract(epoch FROM coalesce(last_order_at, 'epoch')) AS sort_epoch FROM rows)
     SELECT * FROM keyed
     WHERE ${STATE_FILTER[query.state]} AND ($2::boolean IS NULL OR (order_count >= 2) = $2) AND ${keyset}
     ORDER BY ${order} LIMIT $3`,
    [participantId, query.repeat ?? null, query.limit + 1, ...key],
  )
  const keyOf = (row: ListRow) => byName ? [row.display_name ?? '', row.servicing_id] : [row.sort_none, row.sort_epoch, row.servicing_id]
  return { rows, keyOf }
}

const customerView = (row: CustomerRow, contactVisible: boolean) => ({
  customer_id: row.customer_id,
  display_name: row.display_name,
  serviced_by_position_ref: row.position_ref,
  since: row.valid_from,
  until: row.valid_to,
  last_order_at: row.last_order_at,
  order_count: row.order_count,
  repeat: row.order_count >= 2,
  ...(contactVisible ? { contact_masked: maskContact(row.contact) } : {}),
})

const contactVisible = async (tx: Tx): Promise<boolean> => (await getSetting(tx, 'portal.customer_contact_visible')) === true

export function registerMyCustomerRoutes(app: FastifyInstance): void {
  const portal = { preHandler: [requirePortal()] }

  app.get('/v1/me/customers', portal, async (request) => {
    const auth = currentAuth(request)
    assertPortalActive(auth)
    const query = parse(listQuery, request.query)
    return inPortal(request, async (tx) => {
      const { rows, keyOf } = await customerList(tx, auth.participantId!, query)
      const visible = await contactVisible(tx)
      const page = toPage(rows, query.limit, keyOf)
      return envelope(page.data.map((row) => customerView(row, visible)), page.meta)
    })
  })

  app.get('/v1/me/customers/:id', portal, async (request) => {
    const auth = currentAuth(request)
    assertPortalActive(auth)
    const { id } = parse(idParams, request.params)
    return envelope(await inPortal(request, async (tx) => {
      const { rows } = await tx.query<CustomerRow>(
        `${OWN_ROWS}
         SELECT * FROM rows WHERE customer_id = $2 ORDER BY valid_from DESC, servicing_id`,
        [auth.participantId!, id],
      )
      if (rows[0] === undefined) throw notFound()
      const visible = await contactVisible(tx)
      // Only the orders attributed to the participant's own servicing positions of this customer.
      const { rows: orders } = await tx.query(
        `SELECT ordered_at, source_order_id FROM sales_order WHERE buyer_id = $1 AND attributed_position_id = ANY ($2::uuid[])
         ORDER BY ordered_at DESC, id LIMIT ${LAST_ORDERS}`,
        [id, [...new Set(rows.map((row) => row.servicing_position_id))]],
      )
      return {
        customer_id: id,
        display_name: rows[0].display_name,
        ...(visible ? { contact_masked: maskContact(rows[0].contact) } : {}),
        servicing: rows.map((row) => ({ position_ref: row.position_ref, since: row.valid_from, until: row.valid_to, order_count: row.order_count })),
        last_orders: orders,
      }
    }))
  })
}
