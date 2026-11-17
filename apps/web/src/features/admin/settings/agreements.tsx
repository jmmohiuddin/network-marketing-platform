'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Button } from '../../../components/button'
import { DataTable, type DataTableColumn } from '../../../components/data-table'
import { FileDropZone } from '../../../components/file-drop-zone'
import { Checkbox, Select, TextInput } from '../../../components/form-field'
import { StatusBadge } from '../../../components/status-badge'
import { useToast } from '../../../components/toast'
import { newIdempotencyKey } from '../../../lib/api'
import { MARKETS_PATH, type Market } from '../../../lib/markets'
import { useSession } from '../../../lib/session'
import { useResource } from '../../../lib/use-resource'
import { requiredError } from '../../../lib/validation'
import { DocumentLink } from '../../markets/gate-inspector'
import { useEvidenceFile } from '../../markets/evidence-forms'
import { extensionsOf } from '../../markets/format'
import type { DocumentLimits } from '../../markets/types'
import { FormDialog } from '../form-dialog'
import { formatDateTime } from '../format'
import { LoadFailure } from '../page-states'
import { tableError } from '../resource'
import { MONO, NOTE, SECTION_CARD, SectionTitle } from '../ui'
import { AGREEMENT_VERSIONS_PATH, type AgreementVersion } from './types'

const PUBLISH = 'agreement.publish'
const LABEL_MAX = 50
const NUMBER = new Intl.NumberFormat()

/** A count the API sends as a number or a bigint string, grouped without float arithmetic. */
export function countText(value: number | string): string {
  return NUMBER.format(BigInt(value))
}

/**
 * POST /v1/documents (class agreement) then POST /v1/agreement-versions. The upload runs once per chosen file (its own
 * Idempotency-Key), so a refused publish retries without uploading again.
 */
function PublishDialog({ markets, limits, onClose, onDone }: { readonly markets: readonly Market[]; readonly limits: DocumentLimits; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const document = useEvidenceFile('agreement')
  const [marketId, setMarketId] = useState('')
  const [label, setLabel] = useState('')
  const [required, setRequired] = useState(true)
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  // FormDialog renews its key on a form change event, which a dropped file never fires: a new file takes a new key too.
  const [attempt, setAttempt] = useState<{ readonly formKey: string; readonly file: File | null; readonly key: string } | null>(null)
  const ids = { market_id: 'agreement-market', label: 'agreement-label', document_id: 'agreement-file' }
  function submit(formKey: string) {
    const found = {
      market_id: marketId === '' ? 'Choose the market.' : null,
      label: requiredError('a label, for example NL v1', label),
      document_id: document.file === null ? 'Choose the agreement file.' : null,
    }
    setErrors(found)
    const items = Object.entries(found).flatMap(([field, message]) => (message === null ? [] : [{ fieldId: ids[field as keyof typeof ids], message }]))
    if (items.length > 0) return { items }
    const idempotencyKey = attempt?.formKey === formKey && attempt.file === document.file ? attempt.key : newIdempotencyKey()
    setAttempt({ formKey, file: document.file, key: idempotencyKey })
    return {
      items,
      fieldIds: ids,
      send: async () => {
        const uploaded = await document.upload(api)
        await api.post(AGREEMENT_VERSIONS_PATH, { market_id: marketId, label: label.trim(), document_id: uploaded.id, acceptance_required: required }, { idempotencyKey })
        toast({ message: `Agreement ${label.trim()} published.` })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Publish agreement version" submitLabel="Publish version" onClose={onClose} onSubmit={submit}>
      <p>The new version becomes the market’s current agreement at once. Enrolments then accept this version.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
        <Select id={ids.market_id} label="Market" placeholder="Choose a market" value={marketId} error={errors.market_id}
          options={markets.map((market) => ({ value: market.id, label: market.code }))} onChange={(event) => setMarketId(event.target.value)} />
        <TextInput id={ids.label} label="Label" maxLength={LABEL_MAX} value={label} error={errors.label} onChange={(event) => setLabel(event.target.value)} />
      </div>
      <FileDropZone id={ids.document_id} label="Agreement document" extensions={extensionsOf(limits.types)} maxBytes={limits.max_file_bytes} error={errors.document_id} onFiles={document.choose} />
      <Checkbox label="Participants must accept this version at enrolment" checked={required} onChange={(event) => setRequired(event.target.checked)}
        helper="Enrolments into the market without an acceptance of the current version are refused." />
    </FormDialog>
  )
}

const COLUMNS: readonly DataTableColumn<AgreementVersion>[] = [
  { key: 'market', header: 'Market', cell: (version) => <span className={MONO}>{version.market.code}</span> },
  {
    key: 'version', header: 'Version', cell: (version) => (
      <div className="flex flex-wrap items-center gap-space-xs"><span className="font-semibold">{version.label}</span>{version.current && <StatusBadge state="active" label="Current" />}</div>
    ),
  },
  { key: 'document', header: 'Document', cell: (version) => <DocumentLink className={`${MONO} text-primary underline break-all`} document={version.document} fallback="Agreement document" /> },
  { key: 'required', header: 'Acceptance', cell: (version) => (version.acceptance_required ? 'Required at enrolment' : 'Not required') },
  { key: 'accepted', header: 'Accepted', align: 'end', cell: (version) => countText(version.acceptances.accepted) },
  { key: 'open', header: 'Not accepted', align: 'end', cell: (version) => countText(version.acceptances.not_accepted) },
  {
    key: 'published', header: 'Published', cell: (version) => (
      <div className="flex flex-col"><span>{version.published_by.display_name ?? 'Another user'}</span><span className={`${MONO} text-secondary`}>{formatDateTime(version.published_at)}</span></div>
    ),
  },
]

/** SC-29 Agreement versions (FR-PAR-006, D-B2-15): per market, newest first, with acceptance counts; agreement.publish publishes. */
export function AgreementsSection() {
  const { can, readOnly } = useSession()
  const versions = useResource<readonly AgreementVersion[]>(AGREEMENT_VERSIONS_PATH)
  const [publishing, setPublishing] = useState(false)
  const markets = useResource<readonly Market[]>(publishing ? MARKETS_PATH : null)
  const limits = useResource<DocumentLimits>(publishing ? '/v1/documents/limits' : null)
  const failed = markets.error ?? limits.error
  return (
    <section className={SECTION_CARD} aria-labelledby="agreements-title">
      <SectionTitle id="agreements-title" icon="description" title="Agreement versions"
        action={!readOnly && can(PUBLISH) ? <Button icon="publish" onClick={() => setPublishing(true)}>Publish version</Button> : undefined} />
      <p className={NOTE}>The participant agreement of each market. The latest published version is current; acceptances are counted over active participants.</p>
      {publishing && failed !== null && <LoadFailure error={failed} onRetry={() => { markets.reload(); limits.reload() }} section />}
      <DataTable
        bare caption="Agreement versions" columns={COLUMNS} rows={versions.data ?? []} rowKey={(version) => version.id} loading={versions.loading}
        error={tableError(versions)} empty={{ title: 'No agreement version is published. Each market needs one before it can go live.' }}
      />
      {publishing && markets.data !== null && limits.data !== null && (
        <PublishDialog
          markets={markets.data} limits={limits.data} onClose={() => setPublishing(false)}
          onDone={() => {
            setPublishing(false)
            versions.reload()
          }}
        />
      )}
    </section>
  )
}
