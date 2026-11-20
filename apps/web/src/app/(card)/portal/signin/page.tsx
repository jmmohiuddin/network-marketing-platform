import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { PortalSignIn } from '../../../../features/auth/portal-sign-in'
import { translator } from '../../../../features/portal/i18n'
import { requestLocale } from '../../../../features/portal/i18n/server'
import { firebaseAuthDomain } from '../../../../lib/csp'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await requestLocale())('auth.page_title') }
}

/** SC-27 portal sign-in in the Accept-Language match among the supported locales (D-BM-11). */
export default async function PortalSignInPage() {
  const locale = await requestLocale()
  // Same check as proxy.ts, which adds the Firebase sources on this auth page (BUG-101).
  const firebase = firebaseAuthDomain(process.env.FIREBASE_AUTH_DOMAIN) !== null
  return (
    <div lang={locale} className="contents">
      <Suspense fallback={<LoadingState label={translator(locale)('auth.loading')} />}>
        <PortalSignIn firebase={firebase} locale={locale} />
      </Suspense>
    </div>
  )
}
