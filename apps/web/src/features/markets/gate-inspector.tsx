'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { Button } from '../../components/button'
import { Icon } from '../../components/icon'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import type { Resource } from '../../lib/use-resource'
import { LoadFailure } from '../admin/page-states'
import { MONO, NOTE } from '../admin/ui'
import { saveFile } from '../data/transfer'
import { AttestationForm, EvidenceForm } from './evidence-forms'
import { BASIS_STATUS, documentHref, fetchDocument, ITEM_STATUS, KIND_LABELS } from './format'
import type { ChecklistEntry, ChecklistItem, DocumentLimits, DocumentSummary, PackRule, ProviderRecord } from './types'

const LABEL = 'font-caption text-caption text-secondary uppercase font-semibold'

interface DocumentLinkProps {
  readonly document: Pick<DocumentSummary, 'id' | 'file_name'>
  readonly fallback: string
  readonly className: string
}

/**
 * A stored document's download. In a read-only support session a plain link cannot send X-Support-Session, so the
 * file is fetched with it and handed to the browser's save dialog.
 */
export function DocumentLink({ document, fallback, className }: DocumentLinkProps) {
  const { readOnly } = useSession()
  const [problem, setProblem] = useState<string | null>(null)
  const name = document.file_name ?? fallback
  if (!readOnly) return <a className={className} href={documentHref(document.id)} download>{name}</a>
  const download = () => {
    setProblem(null)
    fetchDocument(document.id).then((blob) => saveFile(blob, name), (error: unknown) => setProblem(`${name} was not downloaded. ${errorMessage(error)}`))
  }
  return (
    <>
      <button type="button" className={`${className} text-left`} onClick={download}>{name}</button>
      {problem !== null && <span role="alert" className="font-caption text-caption text-error">{problem}</span>}
    </>
  )
}

/** Evidence file name (download link) and its SHA-256, as sc_17 draws the evidence column. */
export function EvidenceFile({ entry }: { readonly entry: ChecklistEntry }) {
  if (entry.document === null) return null
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <Icon name="description" size={16} className="text-tertiary" />
        <DocumentLink className={`${MONO} text-primary underline truncate max-w-[220px]`} document={entry.document} fallback="Evidence document" />
      </div>
      <div className={`${MONO} text-on-surface-variant break-all`}><span className="sr-only">SHA-256 </span>{entry.document.sha256}</div>
    </div>
  )
}

/** FR-CPL-012 pack rules with their basis status, source and review (never a legal conclusion). */
export function RuleList({ rules }: { readonly rules: readonly PackRule[] }) {
  if (rules.length === 0) return <p className={NOTE}>The market pack has no rules of this kind in force today.</p>
  return (
    <ul aria-label="Market-pack rules" className="flex flex-col gap-space-xs">
      {rules.map((rule) => (
        <li key={rule.id} className="p-space-sm bg-surface-container rounded border border-outline-variant flex flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-space-xs">
            <span className="font-body-sm text-body-sm font-semibold text-on-surface">{rule.title}</span>
            <StatusBadge {...BASIS_STATUS[rule.basis_status]} />
          </div>
          <span className={`${MONO} text-secondary`}><span className="break-all">{rule.id}</span>{rule.mandatory ? <span className="whitespace-nowrap"> · mandatory</span> : null}</span>
          <span className="font-caption text-caption text-on-surface-variant">Basis: {rule.basis}</span>
          <span className="font-caption text-caption text-on-surface-variant">Source: {rule.source_ref}</span>
          <span className="font-caption text-caption text-on-surface-variant">
            {rule.reviewed_by === null ? 'Not reviewed yet' : `Reviewed by ${rule.reviewed_by}${rule.reviewed_at === null ? '' : ` on ${rule.reviewed_at}`}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

function ProviderList({ records, canWithdraw, onWithdraw }: { readonly records: readonly ProviderRecord[]; readonly canWithdraw: boolean; readonly onWithdraw: (record: ProviderRecord) => void }) {
  if (records.length === 0) return <p className={NOTE}>No provider approval is recorded for this market.</p>
  return (
    <ul aria-label="Provider approvals" className="flex flex-col gap-space-xs">
      {records.map((record) => (
        <li key={record.id} className="p-space-sm bg-surface-container rounded border border-outline-variant flex flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-space-xs">
            <span className="font-body-sm text-body-sm font-semibold text-on-surface">{record.provider}</span>
            <StatusBadge state={record.state === 'recorded' ? 'accepted' : 'retired'} label={record.state === 'recorded' ? 'Recorded' : 'Withdrawn'} />
          </div>
          {record.approved_description !== null && <span className="font-caption text-caption text-on-surface-variant">{record.approved_description}</span>}
          <span className="font-caption text-caption text-on-surface-variant">Approved on {record.approved_at ?? '—'} · funds held by {record.funds_holder ?? '—'}</span>
          {record.approval_document !== null && (
            <DocumentLink className={`${MONO} text-primary underline`} document={record.approval_document} fallback="Approval document" />
          )}
          <span className="font-caption text-caption text-secondary">Recorded by {record.created_by.display_name ?? 'another user'}, {formatDateTime(record.created_at)}</span>
          {canWithdraw && record.state === 'recorded' && (
            <div><Button size="sm" variant="destructive" onClick={() => onWithdraw(record)}>Withdraw</Button></div>
          )}
        </li>
      ))}
    </ul>
  )
}

export interface GateInspectorProps {
  readonly marketId: string
  readonly item: ChecklistItem
  /** Why entries cannot be recorded now (not market.manage, read-only, live, pending request); null when they can. */
  readonly locked: string | null
  /** GET /v1/documents/limits; requested only for users who prepare launches. */
  readonly limits: Resource<DocumentLimits>
  readonly providers: Resource<readonly ProviderRecord[]>
  readonly onRecorded: () => void
  readonly onRecordProvider: (kind: 'payout' | 'payment') => void
  readonly onWithdrawProvider: (record: ProviderRecord) => void
}

function Section({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL}>{label}</span>
      {children}
    </div>
  )
}

interface LoadedProps<T> {
  readonly resource: Resource<T>
  readonly label: string
  readonly children: (data: T) => ReactNode
}

/** A section that needs a resource: loading, its failure with Retry, or its content once loaded. */
function Loaded<T>({ resource, label, children }: LoadedProps<T>) {
  if (resource.error !== null) return <LoadFailure error={resource.error} onRetry={resource.reload} section />
  if (resource.data === null) return <LoadingState label={label} />
  return children(resource.data)
}

const LIMITS_LABEL = 'Loading the allowed file types'

/** sc_17 gate inspector: what completes the item, what is recorded, and how to record it. */
export function GateInspector({ marketId, item, locked, limits, providers, onRecorded, onRecordProvider, onWithdrawProvider }: GateInspectorProps) {
  const status = ITEM_STATUS[item.status]
  const providerKind = item.item === 'payout_provider' ? 'payout' : 'payment'
  return (
    <aside aria-labelledby="inspector-title" className="min-[1440px]:col-span-4 min-w-0 flex flex-col bg-surface-container-lowest border border-outline-variant rounded-sm shadow-md">
      <div className="p-space-sm border-b border-outline-variant bg-surface-container-high flex items-center justify-between gap-space-sm">
        <h2 id="inspector-title" className="font-section-heading text-section-heading text-on-surface font-semibold">{item.title}</h2>
        <StatusBadge {...status} />
      </div>
      <div className="p-space-md flex flex-col gap-space-sm">
        <span className="font-caption text-caption text-on-surface-variant">{KIND_LABELS[item.kind]} · mandatory</span>
        {item.entry !== null && (
          <Section label="Recorded">
            <div className="p-space-sm bg-surface-container rounded border border-outline-variant flex flex-col gap-1">
              <EvidenceFile entry={item.entry} />
              {item.entry.note !== null && <p className="font-body-sm text-body-sm text-on-surface whitespace-pre-wrap">{item.entry.note}</p>}
              <span className="font-caption text-caption text-secondary">By {item.entry.recorded_by.display_name ?? 'another user'}, {formatDateTime(item.entry.recorded_at)}</span>
            </div>
          </Section>
        )}
        {item.kind === 'provider' && (
          <Section label="Provider approvals">
            <Loaded resource={providers} label="Loading the provider approvals">
              {(all) => (
                <>
                  <ProviderList records={all.filter((record) => record.kind === providerKind)} canWithdraw={locked === null} onWithdraw={onWithdrawProvider} />
                  {locked === null && (
                    <Loaded resource={limits} label={LIMITS_LABEL}>
                      {() => <Button icon="add" onClick={() => onRecordProvider(providerKind)}>Record provider approval</Button>}
                    </Loaded>
                  )}
                </>
              )}
            </Loaded>
          </Section>
        )}
        {item.item === 'data_region' && <p className={NOTE}>Your tenant’s data is held in region <span className={`${MONO} text-on-surface`}>{item.detail?.region ?? '—'}</span>. Attest that it suits this market.</p>}
        {item.item === 'breach_contacts' && (
          <p className={NOTE}>
            {item.detail?.contacts ?? 0} breach-notification contacts in force. They are set in <Link className="text-primary underline" href="/settings">Settings</Link>.
          </p>
        )}
        {item.item === 'agreement_versions' && (
          <p className={NOTE}>
            {item.detail?.version == null
              ? 'No participant agreement version is published for this market yet. '
              : `Current version ${item.detail.version.label}, published ${formatDateTime(item.detail.version.published_at)}. `}
            Versions are published in <Link className="text-primary underline" href="/settings#agreements-title">Settings</Link>; this item completes itself once one is.
          </p>
        )}
        {item.item === 'pack_rules' && (
          <Section label="Market-pack rules">
            <p className={NOTE}>Mandatory rules still at screening need a written risk acceptance at sign-off.</p>
            <RuleList rules={item.detail?.rules ?? []} />
          </Section>
        )}
        {item.item === 'tax_configuration' && (
          <Section label="Tax rules of the market pack"><RuleList rules={item.detail?.rules ?? []} /></Section>
        )}
        {locked !== null && (item.kind === 'evidence' || item.kind === 'attestation' || item.kind === 'provider') && <p className={NOTE}>{locked}</p>}
        {/* Keyed by the entry: a recorded file starts a fresh form (an uploaded document is referenced once). */}
        {locked === null && item.kind === 'evidence' && (
          <Loaded resource={limits} label={LIMITS_LABEL}>
            {(loaded) => <EvidenceForm key={`${item.item}:${item.entry?.id ?? ''}`} marketId={marketId} item={item.item} title={item.title} limits={loaded} onRecorded={onRecorded} />}
          </Loaded>
        )}
        {locked === null && item.kind === 'attestation' && <AttestationForm key={`${item.item}:${item.entry?.id ?? ''}`} marketId={marketId} item={item.item} title={item.title} onRecorded={onRecorded} />}
      </div>
    </aside>
  )
}
