'use client'

import Link from 'next/link'
import { Fragment, useState, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { ConfirmDialog } from '../../components/dialog'
import { PageHeader } from '../../components/page-header'
import { ErrorState, LoadingState, NotAvailable } from '../../components/states'
import { StatusChip } from '../../components/status-chip'
import { useToast } from '../../components/toast'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { BatchFindings } from './batch-findings'
import { BatchMapping } from './batch-mapping'
import { integer, periodRange } from './format'
import type { Batch, BatchState, DataQuality } from './types'
import { useResource } from '../../lib/use-resource'

const SUMMARY: Readonly<Record<BatchState, string>> = {
  uploaded: 'The files are being checked.',
  rejected: 'The files were rejected and nothing was stored. Fix the errors below and upload the files again.',
  validated: 'The files passed validation. Attach an approved mapping version to continue.',
  mapped: 'A mapping version is attached. Load the batch to make it available to compliance reports.',
  loaded: 'The batch is loaded and in force for its market and period.',
  superseded: 'A later batch for this period replaced this one. It stays readable, and snapshots made with it keep pointing to it.',
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="data-section" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Facts({ items }: { readonly items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="data-facts">
      {items.map(([term, value]) => <Fragment key={term}><dt>{term}</dt><dd>{value}</dd></Fragment>)}
    </dl>
  )
}

const share = (part: number, whole: number) => `${integer(part)} of ${integer(whole)}`

function DataQualityReport({ quality }: { readonly quality: DataQuality }) {
  const unmapped = [...quality.unmapped.purposes, ...quality.unmapped.source_kinds]
  return (
    <>
      <Facts
        items={[
          ['Orders with unknown purpose', share(quality.orders_unknown_purpose, quality.orders)],
          ['Refunded orders without a refund month', share(quality.refunds_without_month, quality.refunded_orders)],
          ['Payout lines without a source order', share(quality.payout_lines_without_source_order, quality.payout_lines)],
          ['Payout lines with unknown source kind', share(quality.payout_lines_unknown_source_kind, quality.payout_lines)],
        ]}
      />
      {unmapped.length > 0 && (
        <p className="data-note">
          Partner codes the mapping did not name were loaded as unknown: <span className="data-code">{unmapped.join(', ')}</span>.
        </p>
      )}
    </>
  )
}

function ValidationReport({ batch }: { readonly batch: Batch }) {
  const counts = batch.row_counts
  const totals = batch.control_totals
  return (
    <>
      <Facts
        items={[
          ...(counts === null ? [] : [
            ['Participants', integer(counts.participants)],
            ['Orders', integer(counts.orders)],
            ['Payout lines', integer(counts.payout_lines)],
          ] as const),
          ...(totals === null ? [] : [
            ['Order amount (minor units)', integer(totals.order_amount_minor)],
            ['Order volume (minor units)', integer(totals.order_volume_minor)],
            ['Refunded (minor units)', integer(totals.order_refunded_minor)],
            ['Payout amount (minor units)', integer(totals.payout_amount_minor)],
          ] as const),
          ['Validation errors', integer(batch.report?.error_count ?? 0)],
        ]}
      />
      {(batch.report?.warnings.length ?? 0) > 0 && (
        <ul className="data-list" aria-label="Warnings">
          {batch.report!.warnings.map((warning) => (
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
    toast({ message: superseded === 0 ? 'Batch loaded.' : `Batch loaded. ${superseded} earlier batch(es) of this period are now superseded.`, tone: 'success' })
    setConfirmLoad(false)
    reload()
  }

  const period = periodRange(batch.period_from, batch.period_to)
  const errorCount = batch.report?.error_count ?? 0
  const actions = batch.state === 'rejected'
    ? <LinkButton href="/imports/new" variant="primary">Upload corrected files</LinkButton>
    : batch.state === 'mapped'
      ? (readOnly ? undefined : <Button variant="primary" onClick={() => setConfirmLoad(true)}>Load batch</Button>)
      : (batch.state === 'loaded' && can('compliance.read')) ? <LinkButton href="/compliance">Compliance reports</LinkButton> : undefined
  return (
    <>
      <PageHeader title={`Import ${batch.market} · ${period}`} state={<StatusChip state={batch.state} />} summary={SUMMARY[batch.state]} actions={actions} />
      {batch.state === 'rejected' && (
        <Banner tone="danger" title="Rejected: nothing was stored">
          {integer(errorCount)} validation error(s) were found. The files are not kept; upload corrected files as a new batch.
        </Banner>
      )}
      {batch.state === 'superseded' && batch.superseded_by !== null && (
        <Banner tone="info" title="Superseded, read-only">
          Replaced by <Link href={`/imports/${batch.superseded_by}`}>a later batch</Link>. Snapshots made with this batch still show their figures.
        </Banner>
      )}
      {(batch.state === 'validated' || batch.state === 'mapped') && (
        <Section title="Mapping">
          {batch.mapping_version !== null && <p>Version {batch.mapping_version} is attached. Attach another approved version to replace it before loading.</p>}
          {!readOnly && <BatchMapping batch={batch} primary={batch.state === 'validated'} onAttached={reload} />}
        </Section>
      )}
      <Section title="Validation report">
        <ValidationReport batch={batch} />
      </Section>
      {errorCount > 0 && (
        <Section title="Validation errors">
          <BatchFindings batchId={batch.id} errorCount={errorCount} stored={batch.report?.errors_stored ?? 0} />
        </Section>
      )}
      {batch.data_quality !== null && (
        <Section title="Data-quality report">
          <DataQualityReport quality={batch.data_quality} />
        </Section>
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
