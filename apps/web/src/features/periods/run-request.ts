'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { newIdempotencyKey } from '../../lib/api'

export interface RunRequest {
  /** The period whose request is in flight, or null. */
  readonly busy: string | null
  readonly error: unknown
  /** POST /v1/periods/:id/runs; resolves the run id (an existing queued or running run's id when there is one), or null on a refusal. */
  readonly start: (periodId: string) => Promise<string | null>
}

/** Calculate / Re-run (API-18): one Run-Request-Id per click, held until the response (D-B3-09, TS-14). */
export function useRunRequest(): RunRequest {
  const api = useApi()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  async function start(periodId: string): Promise<string | null> {
    const runRequestId = newIdempotencyKey()
    setBusy(periodId)
    setError(null)
    try {
      const { data } = await api.post<{ run_id: string }>(`/v1/periods/${periodId}/runs`, {}, { headers: { 'Run-Request-Id': runRequestId } })
      return data.run_id
    } catch (failure) {
      setError(failure)
      return null
    } finally {
      setBusy(null)
    }
  }
  return { busy, error, start }
}
