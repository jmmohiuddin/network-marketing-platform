'use client'

import { createContext, use, useCallback, useEffect, useState } from 'react'
import { useApi } from '../components/api-provider'
import type { Me } from './me'
import { supportFrameOf } from './support-session'

export interface MeState {
  readonly me: Me | null
  readonly error: unknown
  readonly reload: () => void
}

/** Loads GET /v1/me once; reload() fetches again (Retry). */
export function useMe(): MeState {
  const api = useApi()
  const [state, setState] = useState<{ me: Me | null; error: unknown }>({ me: null, error: null })
  const reload = useCallback(() => {
    setState({ me: null, error: null })
    api.get<Me>('/v1/me').then(
      ({ data }) => setState({ me: data, error: null }),
      (error: unknown) => setState({ me: null, error }),
    )
  }, [api])
  useEffect(reload, [reload])
  return { ...state, reload }
}

export interface Session {
  readonly me: Me
  readonly can: (permission: string) => boolean
  /** A vendor user inside a support session: every write control is hidden (the API refuses writes too). */
  readonly readOnly: boolean
}

export const SessionContext = createContext<Me | null>(null)

/** The signed-in user inside AppShell; can() hides controls the user may not use (the API still checks). */
export function useSession(): Session {
  const me = use(SessionContext)
  if (me === null) throw new Error('useSession is only available inside AppShell')
  return { me, can: (permission) => me.permissions.includes(permission), readOnly: supportFrameOf(me) !== null }
}
