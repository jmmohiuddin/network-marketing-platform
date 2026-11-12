'use client'

import { useState } from 'react'

export interface CursorPages {
  /** Cursor of the page to fetch now (undefined = first page). */
  readonly cursor: string | undefined
  readonly hasPrevious: boolean
  /** Moves to the page after the current one, using the meta.next_cursor of the current page. */
  readonly next: (nextCursor: string) => void
  readonly previous: () => void
  /** Back to the first page (filters changed). */
  readonly reset: () => void
}

/**
 * Cursor pagination state (TR-API-09: opaque cursor, no page numbers): the trail of cursors of the pages
 * visited, so Previous works although the API only gives a next cursor.
 */
export function useCursorPages(): CursorPages {
  const [trail, setTrail] = useState<readonly (string | undefined)[]>([undefined])
  return {
    cursor: trail.at(-1),
    hasPrevious: trail.length > 1,
    next: (nextCursor) => setTrail((current) => [...current, nextCursor]),
    previous: () => setTrail((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    reset: () => setTrail([undefined]),
  }
}
