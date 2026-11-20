import type { Finding } from './types'

/** Refusal findings of apply (MIGRATION_INVALID) and opening uploads (OPENING_INVALID): row or reference, code, detail. */
export function Findings({ findings }: { readonly findings: readonly Finding[] }) {
  return (
    <ul aria-label="Findings" className="mt-1 flex flex-col gap-0.5 list-disc pl-space-md">
      {findings.map((finding, index) => (
        <li key={`${finding.code}-${index}`}>
          {finding.row != null && <span className="font-data-mono-sm text-data-mono-sm">Row {finding.row}: </span>}
          {finding.ref !== undefined && <span className="font-data-mono-sm text-data-mono-sm">{finding.ref}: </span>}
          {finding.detail} <span className="font-data-mono-sm text-data-mono-sm text-secondary">({finding.code})</span>
        </li>
      ))}
    </ul>
  )
}
