import type { Metadata } from 'next'
import { InvitationForm } from '../../../features/auth/invitation-form'
import { translator, type Locale } from '../../../features/portal/i18n'
import { requestLocale } from '../../../features/portal/i18n/server'

type Query = Promise<{ readonly realm?: string | string[] }>

/** A distributor's invitation (?realm=portal) speaks the Accept-Language match (D-BM-11); staff and vendor ones English. */
async function localeOf(searchParams: Query): Promise<Locale> {
  return (await searchParams).realm === 'portal' ? requestLocale() : 'en'
}

export async function generateMetadata({ searchParams }: { readonly searchParams: Query }): Promise<Metadata> {
  return { title: translator(await localeOf(searchParams))('invitation.title') }
}

export default async function InvitationPage({ searchParams }: { readonly searchParams: Query }) {
  const locale = await localeOf(searchParams)
  return <div lang={locale} className="contents"><InvitationForm locale={locale} /></div>
}
