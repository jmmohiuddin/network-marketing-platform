import { TaxStatementsPage } from '../../../../../features/portal/tax-statements'
import { portalTitle } from '../../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('tax_forms.title')

export default function Page() {
  return <TaxStatementsPage />
}
