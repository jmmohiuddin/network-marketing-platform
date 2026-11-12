'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { SignOutButton } from '../../components/sign-out-button'
import { ErrorState, LoadingState } from '../../components/states'
import { errorMessage } from '../../lib/messages'
import { homePath } from '../../lib/me'
import { useMe } from '../../lib/session'
import { AuthFooter, AuthHeader } from './auth-card'

/**
 * Role home ("/"): pending MFA first, then the first page of the server's navigation for this user (staff or
 * vendor). Users with no page get an explanation and a way to sign out.
 */
export function HomeRedirect() {
  const { me, error, reload } = useMe()
  const router = useRouter()
  const target = me === null ? null : homePath(me)
  useEffect(() => {
    if (target !== null) router.replace(target)
  }, [target, router])
  if (error !== null) return <ErrorState message={errorMessage(error)} onRetry={reload} />
  if (me === null || target !== null) return <LoadingState label="Opening your home page" />
  return (
    <>
      <AuthHeader eyebrow="Your account" icon="block" title="No pages are available to your account">
        Your account has no role that opens a page yet. Ask your administrator to assign one.
      </AuthHeader>
      <AuthFooter><SignOutButton realm={me.realm} /></AuthFooter>
    </>
  )
}
