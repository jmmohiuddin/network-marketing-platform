import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../../components/states'
import { PortalCode } from '../../../../../features/auth/portal-code'
import { translator } from '../../../../../features/portal/i18n'
import { requestLocale } from '../../../../../features/portal/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await requestLocale())('auth.code') }
}

export default async function PortalCodePage() {
  const locale = await requestLocale()
  return (
    <div lang={locale} className="contents">
      <Suspense fallback={<LoadingState label={translator(locale)('auth.code_loading')} />}>
        <PortalCode locale={locale} />
      </Suspense>
    </div>
  )
}
