import { RankPage, type RankQuery } from '../../../../features/portal/rank'
import { portalTitle } from '../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('nav.rank')

export default async function Page({ searchParams }: { readonly searchParams: Promise<RankQuery> }) {
  return <RankPage query={await searchParams} />
}
