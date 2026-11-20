'use client'

import { Popover } from '../../components/popover'
import type { Definition } from './types'

/** meta.definitions of a dashboard answer, by key. */
export function definitionsOf(meta: Readonly<Record<string, unknown>>): ReadonlyMap<string, Definition> {
  const list = Array.isArray(meta.definitions) ? (meta.definitions as Definition[]) : []
  return new Map(list.map((entry) => [entry.key, entry]))
}

/** (i) definition of a dashboard figure, or nothing when the API sent none for it. */
export function DefinitionPopover({ definition }: { readonly definition: Definition | undefined }) {
  if (definition === undefined) return null
  return (
    <Popover label={`Definition of ${definition.label}`} text="Definition">
      <p>{definition.definition}</p>
      <p className="font-caption text-caption text-secondary mt-space-xxs">Source: {definition.source}</p>
    </Popover>
  )
}
