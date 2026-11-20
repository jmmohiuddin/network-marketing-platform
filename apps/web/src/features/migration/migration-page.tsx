'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { ApprovalBar } from '../../components/approval-bar'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { ConfirmDialog } from '../../components/modal'
import { PageHeader } from '../../components/page-header'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { Stepper } from '../../components/stepper'
import { useToast } from '../../components/toast'
import { ApiError } from '../../lib/api'
import { countLabel, formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { LoadFailure } from '../admin/page-states'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { useIdempotencyKey } from '../admin/resource'
import { withApprovers } from '../admin/settings/labels'
import { inSentence, personName } from '../cases/format'
import { integer, periodRange } from '../data/format'
import { FactRow, FactRows, NOTE, Panel, ScopeStrip } from '../data/ui'
import { periodText } from '../periods/format'
import { useKeptData } from '../plans/ui'
import { Findings } from './findings'
import { countRows, migrationSteps, MIGRATIONS_PAGE, MIGRATIONS_PATH, STATE_BADGES, STATE_LABELS } from './format'
import { OpeningStep } from './opening'
import { ParallelRunStep, RunKpis, runsPath } from './parallel-run'
import type { Finding, Migration, ParallelRun } from './types'

/** A reason dialog for Cancel (draft) and Sign off (migration.signoff, step-up). Mount only while open. */
function ReasonDialog({ title, submitLabel, intro, destructive = false, send, onClose }: {
  readonly title: string
  readonly submitLabel: string
  readonly intro: string
  readonly destructive?: boolean
  readonly send: (reason: string, idempotencyKey: string) => Promise<void>
  readonly onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit(idempotencyKey: string) {
    const missing = reason.trim() === '' ? 'Enter the reason.' : null
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: 'migration-reason', message: missing }] }
    return { items: [], fieldIds: { reason: 'migration-reason' }, send: () => send(reason.trim(), idempotencyKey) }
  }
  return (
    <FormDialog title={title} submitLabel={submitLabel} submitVariant={destructive ? 'destructive-solid' : 'primary'} onClose={onClose} onSubmit={submit}>
      <p>{intro}</p>
      <TextAreaField id="migration-reason" label="Reason" value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}

/** Step 1 and Apply: the batch, its findings, Apply (draft, cannot be undone) with the counts written. */
function SetupSteps({ migration, onChanged }: { readonly migration: Migration; readonly onChanged: () => void }) {
  const api = useApi()
  const toast = useToast()
  const { can, readOnly } = useSession()
  const [confirming, setConfirming] = useState(false)
  const [findings, setFindings] = useState<readonly Finding[] | null>(null)
  const counts = migration.batch.row_counts
  const mayManage = can('migration.manage') && !readOnly
  // Apply succeeds once per migration, and a refused attempt stores no key: one key per mount replays a lost response.
  const applyKey = useIdempotencyKey()
  async function apply() {
    try {
      await api.post(`${MIGRATIONS_PATH}/${migration.id}/apply`, undefined, { idempotencyKey: applyKey })
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'MIGRATION_INVALID')) throw error
      setFindings(((error.details ?? {}) as { findings?: readonly Finding[] }).findings ?? [])
      setConfirming(false)
      return
    }
    setFindings(null)
    setConfirming(false)
    toast({ message: 'The migration was applied.', tone: 'success' })
    onChanged()
  }
  return (
    <>
      <Panel first title="Upload and validate" icon="inventory_2" meta={periodRange(migration.batch.period_from, migration.batch.period_to)}>
        {counts !== null && (
          <FactRows label="Batch rows">
            {Object.entries(counts).map(([file, n]) => <FactRow key={file} label={`${file}.csv`} value={integer(n)} />)}
          </FactRows>
        )}
        <div className="flex flex-wrap gap-space-xs">
          {can('import.manage') && <LinkButton size="sm" icon="fact_check" href={`/imports/${migration.batch.id}`}>Open the batch and its findings</LinkButton>}
          {mayManage && <LinkButton size="sm" icon="cloud_upload" href="/imports/new?kind=migration">Upload a migration batch</LinkButton>}
        </div>
      </Panel>
      <Panel title="Apply" icon="input">
        {migration.applied_counts === null
          ? <p className={NOTE}>Apply writes the participants, positions, sponsor relationships, servicing links and orders of the batch into the market. Apply cannot be undone.</p>
          : (
            <FactRows label="Applied rows">
              {countRows(migration.applied_counts).map((row) => <FactRow key={row.key} label={row.label} value={integer(row.value)} />)}
            </FactRows>
          )}
        {migration.applied_at !== null && <p className={NOTE}>Applied {formatDateTime(migration.applied_at)}.</p>}
        {findings !== null && (
          <Banner tone="danger" title="Not applied: nothing was written">
            <Findings findings={findings} />
          </Banner>
        )}
        {migration.state === 'draft' && mayManage && (
          <div className="flex justify-end"><Button variant="primary" icon="input" data-testid="primary-action" onClick={() => setConfirming(true)}>Apply migration</Button></div>
        )}
      </Panel>
      <ConfirmDialog
        open={confirming} title="Apply migration" confirmLabel="Apply migration" destructive
        consequence={`Writes the ${migration.market.code} history of the batch. Apply cannot be undone, and an applied migration cannot be cancelled.`}
        onConfirm={apply} onCancel={() => setConfirming(false)}
      />
    </>
  )
}

/** The pinned sign-off bar: disabled with the unexplained count until every difference is accepted. */
function SignOffBar({ migration, onSign }: { readonly migration: Migration; readonly onSign: () => void }) {
  const { me, can, readOnly } = useSession()
  const run = migration.latest_parallel_run
  if (migration.state === 'signed_off' && migration.signoff !== null) {
    return <ApprovalBar preparedBy={`Signed off by ${migration.signoff.by.display_name ?? 'another user'}`} preparedAt={formatDateTime(migration.signoff.at)} />
  }
  const blocked = run === null || run.state !== 'compared'
    ? 'Run the comparison first.'
    : run.unexplained > 0 ? `${countLabel(run.unexplained, 'unexplained difference')}` : undefined
  const creator = migration.created_by === me.user.id
  const maySign = can('migration.signoff') && !readOnly && !creator
  return (
    <ApprovalBar
      preparedBy={`Migration created by ${inSentence(personName(migration.created_by, me.user.id))}`}
      preparedAt={formatDateTime(migration.created_at)}
      blockedReason={blocked ?? (creator && can('migration.signoff') ? 'You created this migration, so another Finance approver signs it off.' : undefined)}
      approvers="Sign-off by a Finance approver who neither created the migration nor classified a difference"
      actions={maySign ? <Button variant="primary" icon="verified_user" disabled={blocked !== undefined} onClick={onSign}>Sign off</Button> : undefined}
    />
  )
}

/** SC-16 migration detail: stepper, batch and apply, opening, parallel run and sign-off. */
export function MigrationPage({ migrationId }: { readonly migrationId: string }) {
  const migration = useKeptData(useResource<Migration>(`${MIGRATIONS_PATH}/${migrationId}`, undefined, (m) => m.latest_parallel_run?.state === 'calculating'))
  const markets = useResource<Market[]>(MARKETS_PATH)
  if (migration.error !== null) return <LoadFailure error={migration.error} onRetry={migration.reload} />
  if (migration.data === null) return <LoadingState label="Loading the migration" />
  return <MigrationScreen migration={migration.data} market={markets.data?.find((m) => m.id === migration.data!.market.id)} reload={migration.reload} />
}

function MigrationScreen({ migration, market, reload }: { readonly migration: Migration; readonly market: Market | undefined; readonly reload: () => void }) {
  const api = useApi()
  const toast = useToast()
  const { can, readOnly } = useSession()
  const [dialog, setDialog] = useState<'cancel' | 'signoff' | null>(null)
  const { state } = migration
  const opened = state !== 'draft' && state !== 'cancelled'
  const comparing = state === 'opening_posted' || state === 'signed_off'
  const runs = useResource<ParallelRun[]>(comparing ? runsPath(migration) : null, undefined, (data) => data[0]?.state === 'calculating')
  const compared = runs.data?.[0]?.state === 'compared' ? runs.data[0] : undefined
  const cancel = async (reason: string) => {
    await api.post(`${MIGRATIONS_PATH}/${migration.id}/cancel`, { reason })
    setDialog(null)
    toast({ message: 'The draft migration was cancelled.', tone: 'success' })
    reload()
  }
  const signOff = async (reason: string, idempotencyKey: string) => {
    try {
      await api.post(`${MIGRATIONS_PATH}/${migration.id}/sign-off`, { reason }, { idempotencyKey })
    } catch (error) {
      throw withApprovers(error, 'Finance approver')
    }
    setDialog(null)
    toast({ message: 'The migration is signed off.', tone: 'success' })
    reload()
  }
  return (
    <div className={`flex flex-col gap-space-md ${comparing ? 'pb-56 md:pb-28' : ''}`}>
      <PageHeader
        breadcrumbs={[{ label: 'Migrations', href: MIGRATIONS_PAGE }, { label: migration.market.code }]}
        title={`Migration ${migration.market.code}`}
        state={<StatusBadge state={STATE_BADGES[state]} label={STATE_LABELS[state]} />}
        summary="Legacy history applied once, opening balances and state as of the cutover period, and a parallel run of that period compared with the legacy payouts before sign-off."
        actions={state === 'draft' && can('migration.manage') && !readOnly ? <Button variant="destructive" onClick={() => setDialog('cancel')}>Cancel migration</Button> : undefined}
      />
      <ScopeStrip items={[
        ['Batch', periodRange(migration.batch.period_from, migration.batch.period_to)],
        ['Cutover period', periodText(migration.cutover_period, market?.time_zone)],
        ['Volume key', migration.volume_key],
        ['Created', formatDateTime(migration.created_at)],
      ]} />
      <Stepper label="Migration steps" steps={migrationSteps(migration)} />
      {state === 'cancelled' && <Banner tone="info" title="Cancelled">This draft was cancelled; its batch can start a new migration.</Banner>}
      {compared !== undefined && <RunKpis run={compared} market={market} />}
      {/* sc_16: the work area (opening, parallel run) in 8 columns first, the batch and Apply in 4 beside it. */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-md items-start">
        {opened && (
          <div className="xl:col-span-8 flex flex-col gap-space-md min-w-0">
            <OpeningStep migration={migration} market={market} onChanged={reload} />
            {comparing && <ParallelRunStep migration={migration} market={market} runs={runs} onChanged={reload} />}
          </div>
        )}
        <div className={`${opened ? 'xl:col-span-4' : 'xl:col-span-8'} flex flex-col gap-space-md min-w-0`}>
          <SetupSteps migration={migration} onChanged={reload} />
        </div>
      </div>
      {comparing && <SignOffBar migration={migration} onSign={() => setDialog('signoff')} />}
      {dialog === 'cancel' && (
        <ReasonDialog title="Cancel the draft migration" submitLabel="Cancel migration" destructive intro="Nothing was applied yet; the batch and the market are free for a new migration." send={cancel} onClose={() => setDialog(null)} />
      )}
      {dialog === 'signoff' && (
        <ReasonDialog title={`Sign off migration ${migration.market.code}`} submitLabel="Sign off"
          intro="Every difference of the latest comparison is accepted. After sign-off the cutover period can be calculated and committed. You may be asked for a code from your authenticator app."
          send={signOff} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}
