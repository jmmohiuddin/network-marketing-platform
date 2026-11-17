import type { Tx } from '@nmp/db'
import { hasPermission, marketScope, type AuthContext } from '../../lib/auth.js'
import type { Permission } from '../../lib/permissions.js'
import { canReadCase, casePermissions, holdsFor, type CaseTypeRegistry } from '../cas/index.js'
import type { EvidenceFile } from './evidence-file.js'

/** What the API shows of an evidence document. */
export interface DocumentView {
  readonly id: string
  readonly file_name: string | null
  readonly mime: string
  readonly size_bytes: number
  readonly sha256: string
  readonly uploaded_by: string | null
  readonly uploaded_at: Date
}

// Readers of documents that markets reference: checklist entries, provider records, go-live risk documents.
const MARKET_READERS: readonly Permission[] = ['market.manage', 'market.signoff']
// Readers of a market's agreement versions and so of their documents (PLAN B2 section 2.2).
const AGREEMENT_READERS: readonly Permission[] = ['participant.read', 'agreement.publish', ...MARKET_READERS]
const AGREEMENT_PUBLISHER: Permission = 'agreement.publish'

const COLUMNS = `id, file_name, mime, size_bytes::int AS size_bytes, encode(sha256, 'hex') AS sha256, uploaded_by,
  created_at AS uploaded_at`

const holdsSomewhere = (auth: AuthContext, permission: Permission): boolean => {
  const scope = marketScope(auth, permission)
  return hasPermission(auth, permission) && (scope === null || scope.length > 0)
}

// A market record without a market (provider_config.market_id NULL) is tenant-wide: only unscoped holders read it,
// as PAY lists it (unlike a case without a market, which every holder of the case permission reads).
const readsMarketRecord = (auth: AuthContext, permission: Permission, marketId: string | null): boolean =>
  marketId === null ? hasPermission(auth, permission) && marketScope(auth, permission) === null : holdsFor(auth, permission, marketId)

/** market.manage, market.signoff (go-live risk documents) or the create permission of a case type of the app, over some market. */
export function canUploadEvidence(auth: AuthContext, caseTypes: CaseTypeRegistry): boolean {
  const permissions = [...MARKET_READERS, ...casePermissions(caseTypes).map((permissions) => permissions.create)]
  return permissions.some((permission) => holdsSomewhere(auth, permission))
}

/** Agreement documents: agreement.publish over some market. */
export function canUploadAgreement(auth: AuthContext): boolean {
  return holdsSomewhere(auth, AGREEMENT_PUBLISHER)
}

export async function insertDocument(tx: Tx, id: string, file: EvidenceFile): Promise<DocumentView> {
  const { rows } = await tx.query<DocumentView>(
    `INSERT INTO document (id, tenant_id, class, storage_key, sha256, mime, size_bytes, uploaded_by, version, created_by, file_name)
     VALUES ($1, app_tenant_id(), $7, $6, decode($2, 'hex'), $3, $4, app_user_id(), 1, app_user_id(), $5)
     RETURNING ${COLUMNS}`,
    [id, file.sha256, file.mime, file.data.length, file.fileName, `documents/${id}`, file.documentClass],
  )
  return rows[0]!
}

async function readsAReference(tx: Tx, auth: AuthContext, documentId: string, caseTypes: CaseTypeRegistry): Promise<boolean> {
  const { rows } = await tx.query<{ object_type: string; object_id: string; market_id: string | null }>(
    'SELECT object_type, object_id, market_id FROM document_references($1)',
    [documentId],
  )
  for (const reference of rows) {
    const readers = reference.object_type === 'agreement_version' ? AGREEMENT_READERS : MARKET_READERS
    const readable = reference.object_type === 'case_file'
      ? await canReadCase(tx, auth, reference.object_id, caseTypes)
      : readers.some((permission) => readsMarketRecord(auth, permission, reference.market_id))
    if (readable) return true
  }
  return false
}

/**
 * The evidence or agreement document if the caller uploaded it or may read an object that references it (D-B1-04,
 * document_references); null otherwise, so the route answers 404 whether it exists or not.
 */
export async function readableDocument(
  tx: Tx, auth: AuthContext, id: string, caseTypes: CaseTypeRegistry,
): Promise<DocumentView | null> {
  const { rows } = await tx.query<DocumentView>(`SELECT ${COLUMNS} FROM document WHERE id = $1 AND class IN ('evidence', 'agreement')`, [id])
  const document = rows[0]
  if (document === undefined) return null
  return document.uploaded_by === auth.userId || (await readsAReference(tx, auth, id, caseTypes)) ? document : null
}
