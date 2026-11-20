'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { Select } from '../../components/form-field'
import { LoadingState } from '../../components/states'
import { useToast } from '../../components/toast'
import { isApiError } from '../../lib/api'
import { errorMessage } from '../../lib/messages'
import type { Batch, MappingVersion } from './types'
import { useResource } from '../../lib/use-resource'
import { CONTROLS } from './ui'

// shortcut: the newest 200 versions (one API page) are offered; page through the list if a tenant ever has more.
const VERSIONS_LIMIT = 200

/** MAPPING_INCOMPLETE details: the batch's partner codes the chosen version does not cover. */
function uncoveredCodes(error: unknown): string | null {
  if (!isApiError(error, 'MAPPING_INCOMPLETE')) return null
  const details = (error.details ?? {}) as Record<string, unknown>
  const codes = Object.values(details).flatMap((value) => (Array.isArray(value) ? value.map(String) : []))
  return codes.length === 0 ? null : codes.join(', ')
}

/** The mapping editor for a batch's partner codes, listing only mappings of the batch's kind. */
export const mappingPath = (batch: Pick<Batch, 'id' | 'kind'>): string =>
  `/imports/mappings?batch=${batch.id}${batch.kind === 'migration' ? '&kind=migration' : ''}`

export interface BatchMappingProps {
  readonly batch: Batch
  /** One primary action per view: primary while the batch still needs a mapping. */
  readonly primary: boolean
  readonly onAttached: () => void
}

/** validated | mapped: attach an approved mapping version (POST /v1/imports/:id/mapping). */
export function BatchMapping({ batch, primary, onAttached }: BatchMappingProps) {
  const api = useApi()
  const toast = useToast()
  // D-B6-09: a batch attaches only a mapping of its own kind.
  const versions = useResource<MappingVersion[]>('/v1/import-mappings', { limit: VERSIONS_LIMIT, kind: batch.kind })
  const approved = (versions.data ?? []).filter((version) => version.state === 'approved')
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const mappingLink = <LinkButton href={mappingPath(batch)} icon="route">Open mapping</LinkButton>

  if (versions.loading) return <LoadingState label="Loading mapping versions" />
  if (versions.error !== null) return <Banner tone="danger" action={<Button onClick={versions.reload}>Try again</Button>}>{errorMessage(versions.error)}</Banner>
  if (approved.length === 0) {
    return (
      <Banner tone="info" title="No mapping version is approved yet" action={mappingLink}>
        Open the mapping, map the partner codes of this batch and save a draft. Someone other than its author approves it; then attach it here.
      </Banner>
    )
  }

  const selected = chosen === '' ? (approved.find((version) => version.id === batch.mapping_id) ?? approved[0]!).id : chosen
  async function attach() {
    setBusy(true)
    setFailure(null)
    try {
      await api.post(`/v1/imports/${batch.id}/mapping`, { mapping_id: selected })
      const version = approved.find((item) => item.id === selected)?.version
      toast({ message: `Mapping version ${version} attached.`, tone: 'success' })
      onAttached()
    } catch (error) {
      setFailure(error)
    } finally {
      setBusy(false)
    }
  }

  const uncovered = uncoveredCodes(failure)
  return (
    <div className="flex flex-col gap-space-sm">
      <div className={CONTROLS}>
        <Select
          label="Approved mapping version" value={selected}
          options={approved.map((version) => ({ value: version.id, label: `Version ${version.version}` }))}
          onChange={(event) => setChosen(event.target.value)}
        />
        <Button variant={primary ? 'primary' : 'secondary'} icon="link" loading={busy} onClick={attach} data-testid={primary ? 'primary-action' : undefined}>Attach mapping version</Button>
        {mappingLink}
      </div>
      {failure !== null && (
        <Banner tone="danger" title={uncovered === null ? undefined : 'The mapping does not cover every code of this batch'}>
          {uncovered === null ? errorMessage(failure) : `Map these codes in a new version and have it approved: ${uncovered}.`}
        </Banner>
      )}
    </div>
  )
}
