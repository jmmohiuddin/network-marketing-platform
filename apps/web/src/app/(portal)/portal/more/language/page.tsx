import { LanguagePage } from '../../../../../features/portal/language'
import { portalTitle } from '../../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('language.title')

export default function Page() {
  return <LanguagePage />
}
