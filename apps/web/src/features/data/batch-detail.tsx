'use client'

import { countLabel } from '../../lib/format'
import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { ConfirmDialog } from '../../components/modal'
import { PageHeader } from '../../components/page-header'
import { ErrorState, LoadingState, NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { BatchFindings } from './batch-findings'
import { BatchMapping } from './batch-mapping'
import { dateTime, integer, periodRange } from './format'
import type { Batch, BatchState, DataQuality } from './types'
import { useResource } from '../../lib/use-resource'
import { CODE, FactRow, FactRows, LIST, NOTE, Panel, TableSection } from './ui'

const SUMMARY: Readonly<Record<BatchState, string>> = {
  uploaded: 'The files are being checked.',
  rejected: 'The files were rejected and nothing was stored. Fix the errors below and upload the files again.',
  validated: 'The files passed validation. Attach an approved mapping version to continue.',
  mapped: 'A mapping version is attached. Load the batch to make it available to compliance reports.',
  loaded: 'The batch is loaded and in force for its market and period.',
  superseded: 'A later batch for this period replaced this one. It stays readable, and snapshots made with it keep pointing to it.',
}

const share = (part: number, whole: number) => `${integer(part)} of ${integer(whole)}`

function DataQualityReport({ quality }: { readonly quality: DataQuality }) {
  const unmapped = [...quality.unmapped.purposes, ...quality.unmapped.source_kinds]
  return (
    <>
      <FactRows label="Data quality">
        <FactRow label="Orders with unknown purpose" value={share(quality.orders_unknown_purpose, quality.orders)} />
        <FactRow label="Refunded orders without a refund month" value={share(quality.refunds_without_month, quality.refunded_orders)} />
        <FactRow label="Payout lines without a source order" value={share(quality.payout_lines_without_source_order, quality.payout_lines)} />
        <FactRow label="Payout lines with unknown source kind" value={share(quality.payout_lines_unknown_source_kind, quality.payout_lines)} />
      </FactRows>
      {unmapped.length > 0 && (
        <p className={NOTE}>
          Partner codes the mapping did not name were loaded as unknown: <span className={CODE}>{unmapped.join(', ')}</span>.
        </p>
      )}
    </>
  )
}

function ValidationReport({ batch }: { readonly batch: Batch }) {
  const counts = batch.row_counts
  const totals = batch.control_totals
  const warnings = batch.report?.warnings ?? []
  return (
    <>
      <FactRows label="Row counts and control totals">
        {counts !== null && (
          <>
            <FactRow label="Participants" detail="participants.csv" value={integer(counts.participants)} />
            <FactRow label="Orders" detail="orders.csv" value={integer(counts.orders)} />
            <FactRow label="Payout lines" detail="payout_lines.csv" value={integer(counts.payout_lines)} />
          </>
        )}
        {totals !== null && (
          <>
            <FactRow label="Order amount (minor units)" detail="Sum of amount_cents" value={integer(totals.order_amount_minor)} />
            <FactRow label="Order volume (minor units)" detail="Sum of volume_cents" value={integer(totals.order_volume_minor)} />
            <FactRow label="Refunded (minor units)" detail="Sum of refunded_cents" value={integer(totals.order_refunded_minor)} />
            <FactRow label="Payout amount (minor units)" detail="Sum of payout amount_cents" value={integer(totals.payout_amount_minor)} />
          </>
        )}
        <FactRow label="Validation errors" value={integer(batch.report?.error_count ?? 0)} />
      </FactRows>
      {warnings.length > 0 && (
        <ul className={`${LIST} ${NOTE}`} aria-label="Warnings">
          {warnings.map((warning) => (
            <li key={`${warning.file}:${warning.code}`}>{warning.file}: {warning.detail} ({integer(warning.count)})</li>
          ))}
        </ul>
      )}
    </>
  )
}

/** SC-24 batch detail: validation report, mapping, load, data quality; the primary action follows the state. */
export function BatchDetail({ batchId }: { readonly batchId: string }) {
  const api = useApi()
  const toast = useToast()
  const { can, readOnly } = useSession()
  const { data: batch, error, loading, reload } = useResource<Batch>(`/v1/imports/${batchId}`)
  const [confirmLoad, setConfirmLoad] = useState(false)

  if (error !== null) return isNotAvailable(error) ? <NotAvailable /> : <ErrorState message={errorMessage(error)} onRetry={reload} />
  if (loading || batch === null) return <LoadingState label="Loading the import batch" />

  async function load() {
    const { meta } = await api.post<Batch>(`/v1/imports/${batchId}/load`)
    const superseded = Array.isArray(meta.superseded) ? meta.superseded.length : 0
    toast({ message: superseded === 0 ? 'Batch loaded.' : `Batch loaded. ${countLabel(superseded, 'earlier batch', 'earlier batches')} of this period ${superseded === 1 ? 'is' : 'are'} now superseded.`, tone: 'success' })
    setConfirmLoad(false)
    reload()
  }

  const period = periodRange(batch.period_from, batch.period_to)
  const errorCount = batch.report?.error_count ?? 0
  const actions = batch.state === 'rejected'
    ? (readOnly ? undefined : <LinkButton href="/imports/new" variant="primary" icon="cloud_upload" data-testid="primary-action">Upload corrected files</LinkButton>)
    : batch.state === 'mapped'
      ? (readOnly ? undefined : <Button variant="primary" onClick={() => setConfirmLoad(true)} data-testid="primary-action">Load batch</Button>)
      : (batch.state === 'loaded' && can('compliance.read')) ? <LinkButton href="/compliance" icon="verified_user">Compliance reports</LinkButton> : undefined
  return (
    <>
      <PageHeader
        title={`Import ${batch.market} · ${period}`} state={<StatusBadge state={batch.state} />} summary={SUMMARY[batch.state]} actions={actions}
        eyebrow={batch.id} breadcrumbs={[{ label: 'Data imports', href: '/imports' }, { label: `${batch.market} · ${period}` }]}
      />
      {batch.state === 'rejected' && (
        <Banner tone="danger" title="Rejected: nothing was stored">
          {countLabel(errorCount, 'validation error')} {errorCount === 1 ? 'was' : 'were'} found. The files are not kept; upload corrected files as a new batch.
        </Banner>
      )}
      {batch.state === 'superseded' && batch.superseded_by !== null && (
        <Banner tone="info" title="Superseded, read-only">
          Replaced by <Link href={`/imports/${batch.superseded_by}`} className="text-primary font-semibold hover:underline">a later batch</Link>. Snapshots made with this batch still show their figures.
        </Banner>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-md items-start">
        <Panel first title="Validation report" icon="fact_check" meta={`Uploaded ${dateTime(batch.created_at)}`} className="xl:col-span-7">
          <ValidationReport batch={batch} />
        </Panel>
        <div className="xl:col-span-5 flex flex-col gap-space-md">
          {(batch.state === 'validated' || batch.state === 'mapped') && (
            <Panel title="Mapping" icon="route" meta={batch.mapping_version === null ? undefined : `Version ${batch.mapping_version}`}>
              {batch.mapping_version !== null && <p className={NOTE}>Version {batch.mapping_version} is attached. Attach another approved version to replace it before loading.</p>}
              {readOnly
                ? batch.mapping_version === null && <p className={NOTE}>No mapping version is attached yet.</p>
                : <BatchMapping batch={batch} primary={batch.state === 'validated'} onAttached={reload} />}
            </Panel>
          )}
          {batch.data_quality !== null && (
            <Panel title="Data-quality report" icon="rule">
              <DataQualityReport quality={batch.data_quality} />
            </Panel>
          )}
        </div>
      </div>
      {errorCount > 0 && (
        <TableSection title="Validation errors" summary="What to fix in each file before uploading again.">
          <BatchFindings batchId={batch.id} errorCount={errorCount} stored={batch.report?.errors_stored ?? 0} />
        </TableSection>
      )}
      <ConfirmDialog
        open={confirmLoad}
        title="Load batch"
        consequence={`Loads ${batch.market} ${period} with mapping version ${batch.mapping_version ?? '—'} into the compliance data. Loaded batches of this market within the same months become superseded (kept, read-only), and snapshots made with them are marked Outdated.`}
        confirmLabel="Load batch"
        onConfirm={load}
        onCancel={() => setConfirmLoad(false)}
      />
    </>
  )
}
