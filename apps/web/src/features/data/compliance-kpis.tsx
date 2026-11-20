'use client'

import Link from 'next/link'
import { KpiCard } from '../../components/kpi-card'
import { ErrorState } from '../../components/states'
import { countLabel } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { caseTypeLabel } from '../cases/format'

/** GET /v1/dashboards/compliance (PLAN B6 §2.4). */
export interface ComplianceDashboard {
  readonly guardrail_warnings: number
  readonly open_cases: readonly { readonly type: string; readonly count: number }[]
  readonly overdue_cases: number
}

interface Definition {
  readonly key: string
  readonly label: string
  readonly definition: string
}

export const COMPLIANCE_DASHBOARD_PATH = '/v1/dashboards/compliance'

/** SC-46 touch: Guardrail warnings and Open cases over the markets in scope, each with its definition as detail text. */
export function ComplianceKpis() {
  const { can } = useSession()
  const { data, meta, error, reload } = useResource<ComplianceDashboard>(COMPLIANCE_DASHBOARD_PATH)
  if (error !== null) return <ErrorState section message={`The compliance counts could not be loaded. ${errorMessage(error)}`} onRetry={reload} />
  const definitions = (meta.definitions ?? []) as readonly Definition[]
  const definition = (key: string) => definitions.find((d) => d.key === key)?.definition
  const open = data?.open_cases ?? []
  const total = open.reduce((sum, row) => sum + row.count, 0)
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md" data-testid="compliance-kpis">
      <KpiCard
        label="Guardrail warnings" icon="policy" value={data === null ? null : String(data.guardrail_warnings)}
        detail={data === null ? 'Loading' : (
          <>
            {definition('guardrail_warnings')}
            {can('guardrail.read') && <> <Link className="text-primary font-semibold hover:underline" href="/compliance/guardrails">Open guardrails</Link></>}
          </>
        )}
      />
      <KpiCard
        label="Open cases" icon="folder_open" value={data === null ? null : String(total)}
        detail={data === null ? 'Loading' : (
          <>
            {open.length > 0 && (
              <ul aria-label="Open cases by type" className="flex flex-col">
                {open.map((row) => <li key={row.type}>{caseTypeLabel(row.type)}: {row.count}</li>)}
              </ul>
            )}
            <span className="block">{countLabel(data.overdue_cases, 'overdue case')}. {definition('overdue_cases')}</span>
            <span className="block">{definition('open_cases')}</span>
          </>
        )}
      />
    </div>
  )
}
