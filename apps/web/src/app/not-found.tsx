import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { CardLayout } from '../components/card-layout'
import { NotAvailable } from '../components/states'
import { translator } from '../features/portal/i18n'
import { documentLang } from '../features/portal/i18n/server'
import { PortalNotFound } from '../features/portal/not-found'
import { SURFACE_HEADER } from '../lib/navigation'

const onPortal = async () => (await headers()).get(SURFACE_HEADER) === 'portal'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await onPortal()) ? translator(await documentLang())('failure.not_available') : 'Not found or not available' }
}

/** Unknown URLs and notFound(): the same page as "no permission" (UX-03 §6); under /portal in the portal's language (BUG-136). */
export default async function NotFound() {
  return (
    <CardLayout>
      {(await onPortal()) ? await PortalNotFound() : <NotAvailable plain />}
    </CardLayout>
  )
}
