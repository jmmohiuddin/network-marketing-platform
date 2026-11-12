import type { ReactNode } from 'react'

export interface FilterChip {
  readonly key: string
  /** "Actor: Ada Admin". */
  readonly label: string
  readonly onRemove: () => void
}

/** sc_30 l.105 applied filters: one chip per filter with its remove button, then "Clear all filters". */
export function FilterChips({ chips, onClear }: { readonly chips: readonly FilterChip[]; readonly onClear: () => void }) {
  if (chips.length === 0) return null
  return (
    <div className="flex items-center gap-space-xs flex-wrap">
      <span className="font-caption text-caption text-on-surface-variant">Active filters:</span>
      <ul className="contents">
        {chips.map((chip) => (
          <li key={chip.key} className="inline-flex items-center gap-1 bg-surface-container text-on-surface px-space-xs py-0.5 rounded text-caption font-caption">
            {chip.label}
            <button type="button" className="material-symbols-outlined text-[14px] leading-none rounded hover:text-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Remove filter: ${chip.label}`} title={`Remove filter: ${chip.label}`} onClick={chip.onRemove}>
              close
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="text-primary font-caption text-caption hover:underline ml-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={onClear}>Clear all filters</button>
    </div>
  )
}

export interface FiltersBarProps {
  /** Names the filter region ("Filter audit events"). */
  readonly label: string
  /** Native controls (TextInput, Select); each keeps its label. Filters live in the URL. */
  readonly children: ReactNode
  /** Apply/Reset buttons when the filters are submitted as a form. */
  readonly actions?: ReactNode
  readonly chips?: readonly FilterChip[]
  readonly onClear?: () => void
}

/** sc_30 l.105 filter console: a card with a grid of controls and the applied-filter chips. */
export function FiltersBar({ label, children, actions, chips = [], onClear }: FiltersBarProps) {
  return (
    <section aria-label={label} className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex flex-col gap-space-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-sm items-end">{children}</div>
      {actions !== undefined && <div className="flex flex-wrap items-center justify-end gap-space-xs">{actions}</div>}
      {onClear !== undefined && <FilterChips chips={chips} onClear={onClear} />}
    </section>
  )
}
