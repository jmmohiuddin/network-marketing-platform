import type { Metadata } from 'next'
import { MyDataPage } from '../../../../../features/portal/my-data'

export const metadata: Metadata = { title: 'My data' }

export default function Page() {
  return <MyDataPage />
}
