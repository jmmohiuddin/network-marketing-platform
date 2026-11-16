import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { pgCode } from './pg.js'
import { recordStructureChange } from './structure.js'

export interface BrandView {
  id: string
  name: string
}

const nameTaken = () => new ApiError(409, 'BRAND_NAME_TAKEN', 'The tenant already has a brand with this name.')

export async function listBrands(tx: Tx): Promise<BrandView[]> {
  const { rows } = await tx.query<BrandView>('SELECT id, name FROM brand ORDER BY name, id')
  return rows
}

async function savingName<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (pgCode(error) === '23505') throw nameTaken()
    throw error
  }
}

export async function createBrand(tx: Tx, name: string, reason: string): Promise<BrandView> {
  const brand = await savingName(async () => {
    const { rows } = await tx.query<BrandView>(
      `INSERT INTO brand (tenant_id, name, created_by) VALUES (app_tenant_id(), $1, current_setting('app.user_id')::uuid) RETURNING id, name`,
      [name],
    )
    return rows[0]!
  })
  await recordAudit(tx, { action: 'BRAND.CREATED', objectType: 'brand', objectId: brand.id, after: { name }, reason })
  await recordStructureChange(tx, reason)
  return brand
}

async function lockBrand(tx: Tx, id: string): Promise<BrandView> {
  const { rows } = await tx.query<BrandView>('SELECT id, name FROM brand WHERE id = $1 FOR UPDATE', [id])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

export async function renameBrand(tx: Tx, id: string, name: string, reason: string): Promise<BrandView> {
  const before = await lockBrand(tx, id)
  const brand = await savingName(async () => (await tx.query<BrandView>('UPDATE brand SET name = $2 WHERE id = $1 RETURNING id, name', [id, name])).rows[0]!)
  await recordAudit(tx, { action: 'BRAND.RENAMED', objectType: 'brand', objectId: id, before: { name: before.name }, after: { name }, reason })
  await recordStructureChange(tx, reason)
  return brand
}

/** AC-TEN2-6: a brand a grant is scoped to (role_assignment.brand_ids) cannot be deleted. */
export async function deleteBrand(tx: Tx, id: string, reason: string): Promise<void> {
  const brand = await lockBrand(tx, id)
  const { rows } = await tx.query<{ refs: Record<string, number> }>('SELECT brand_references($1) AS refs', [id])
  const references = rows[0]!.refs
  if (Object.values(references).some((count) => count > 0)) {
    throw new ApiError(409, 'BRAND_REFERENCED', 'The brand is referenced and cannot be deleted.', { references })
  }
  await tx.query('DELETE FROM brand WHERE id = $1', [id])
  await recordAudit(tx, { action: 'BRAND.DELETED', objectType: 'brand', objectId: id, before: { name: brand.name }, reason })
  await recordStructureChange(tx, reason)
}
