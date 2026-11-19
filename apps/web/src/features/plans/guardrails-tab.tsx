'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { Icon } from '../../components/icon'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { newIdempotencyKey } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { BASIS_STATUS } from '../markets/format'
import type { BasisStatus } from '../markets/types'
import { versionApi } from './format'
import type { DraftScope } from './rules-tab'
import type { Decision } from './types'
import { CARD, MONO, NOTE } from './ui'

/** D-B4-21 b: an opaque match where the evaluation or its rule blocks is resolved only by a Compliance officer override. */
export const needsReview = (d: Pick<Decision, 'outcome' | 'detail' | 'rule'>): boolean =>
  d.detail.opaque && (d.outcome === 'blocked' || d.rule.outcome === 'blocked')

/** Who resolved a decision, or what it still needs (D-B3-17, D-B4-21 b). */
export function resolutionText(d: Pick<Decision, 'outcome' | 'acknowledgement' | 'override' | 'rule' | 'detail'>): string {
  if (d.override !== null) return `Overridden by ${d.override.approved_by.display_name ?? 'another user'} on ${formatDateTime(d.override.decided_at)}`
  if (d.acknowledgement !== null) return `Acknowledged by ${d.acknowledgement.decided_by.display_name ?? 'another user'} on ${formatDateTime(d.acknowledgement.decided_at)}`
  if (d.outcome === 'reported') return 'Reported; no action needed'
  if (needsReview(d)) return 'Needs a compliance review: a Compliance officer override'
  if (d.outcome === 'blocked') return d.rule.overridable ? 'Needs an override by a compliance officer' : 'Blocked; change the rule'
  return 'Needs an acknowledgement or an override'
}

export const basisLabel = (status: string): string => BASIS_STATUS[status as BasisStatus]?.label ?? status

/** sc_04 guardrail advisory card: rule, outcome, explanation, matched rules, what resolves it. */
function DecisionCard({ decision, canAcknowledge, onAcknowledge, busy }: { readonly decision: Decision; readonly canAcknowledge: boolean; readonly onAcknowledge: () => void; readonly busy: boolean }) {
  const { can } = useSession()
  return (
    <li className="bg-surface-container-high p-space-md rounded-lg shadow-sm flex items-start gap-space-sm">
      <Icon name={decision.outcome === 'blocked' ? 'block' : 'warning'} size={20} className="text-on-surface mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-space-xs">
          <h2 className="font-section-heading text-section-heading text-on-surface">{decision.rule.id}: {decision.rule.title}</h2>
          <StatusBadge state={decision.outcome} />
        </div>
        <p className="font-body-sm text-body-sm text-on-surface">{decision.detail.explanation}</p>
        {decision.detail.opaque && <p className={NOTE}>An expression or module hides what this rule pays on{needsReview(decision) ? ', so it goes to compliance review.' : ', so it is flagged as a warning.'}</p>}
        <p className={NOTE}>Rules matched: <span className={MONO}>{decision.detail.rule_keys.join(', ')}</span> · Basis status: {basisLabel(decision.rule.basis_status)}</p>
        <div className="pt-1 flex flex-wrap items-center justify-between gap-space-sm">
          <span className="font-caption text-caption text-secondary">{resolutionText(decision)}</span>
          <span className="flex flex-wrap items-center gap-space-sm">
            {can('guardrail.read') && <Link className="font-body-sm text-body-sm font-semibold text-primary hover:underline" href={`/compliance/guardrails?decision=${decision.id}`}>Open in the guardrails log</Link>}
            {canAcknowledge && <Button size="sm" loading={busy} aria-label={`Acknowledge ${decision.rule.id}`} onClick={onAcknowledge}>Acknowledge</Button>}
          </span>
        </div>
      </div>
    </li>
  )
}

/** SC-04 Guardrails tab: the latest decision per guardrail rule; a plan editor acknowledges warnings (FR-CPL-007). */
export function GuardrailsTab({ scope }: { readonly scope: DraftScope }) {
  const api = useApi()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const { decisions, outstanding } = scope.version.guardrails
  async function acknowledge(decision: Decision) {
    setBusy(decision.id)
    setFailure(null)
    try {
      await api.post(`${versionApi(scope.plan.id, scope.version.version)}/guardrail-decisions/${decision.id}/acknowledge`, undefined, { idempotencyKey: newIdempotencyKey() })
      toast({ message: `${decision.rule.id} acknowledged.` })
      scope.reload()
    } catch (error) {
      setFailure(`${decision.rule.id} was not acknowledged. ${errorMessage(error)}`)
    } finally {
      setBusy(null)
    }
  }
  // Acknowledging is authoring: the API refuses it once the version left draft (scope.canEdit).
  const mayAcknowledge = (d: Decision) => scope.canEdit && d.outcome === 'warned' && !needsReview(d) && d.acknowledgement === null && d.override === null
  return (
    <div className="flex flex-col gap-space-md">
      <p className={`${CARD} ${NOTE}`}>
        Guardrails of the plan&apos;s markets are checked on every rule save. {outstanding.length === 0 ? 'No decision is open.' : `${outstanding.length} open: submission waits until each is acknowledged or overridden.`}
      </p>
      {failure !== null && <Banner tone="danger">{failure}</Banner>}
      {decisions.length === 0
        ? <p className={`${CARD} ${NOTE}`}>No guardrail matched the rules of this version.</p>
        : <ul className="flex flex-col gap-space-sm">{decisions.map((d) => <DecisionCard key={d.id} decision={d} canAcknowledge={mayAcknowledge(d)} busy={busy === d.id} onAcknowledge={() => acknowledge(d)} />)}</ul>}
    </div>
  )
}
