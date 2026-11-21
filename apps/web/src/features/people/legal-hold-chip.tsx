'use client'

import Link from 'next/link'
import { StatusBadge } from '../../components/status-badge'
import { useResource } from '../../lib/use-resource'
import { LEGAL_HOLDS_PATH, type LegalHold } from '../privacy/types'

/** SC-09 header chip (D-V1A-08): an active legal hold, linking to the holds list on SC-15; nothing while none is active. */
export function LegalHoldChip({ participantId }: { readonly participantId: string }) {
  const holds = useResource<LegalHold[]>(LEGAL_HOLDS_PATH, { participant_id: participantId, active: 'true' })
  if (holds.error !== null) return <StatusBadge state="unknown" label="Legal hold status not loaded" />
  if (holds.data === null || holds.data.length === 0) return null
  return (
    <Link href="/privacy?tab=holds" data-testid="legal-hold-chip" className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <StatusBadge state="held" label="Legal hold" />
    </Link>
  )
}
