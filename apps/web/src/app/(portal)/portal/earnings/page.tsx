import { EarningsPage, type EarningsQuery } from '../../../../features/portal/earnings'
import { portalTitle } from '../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('nav.earnings')

export default async function Page({ searchParams }: { readonly searchParams: Promise<EarningsQuery> }) {
  return <EarningsPage query={await searchParams} />
}
