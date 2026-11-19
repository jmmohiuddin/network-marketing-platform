import type { ReactNode } from 'react'
import { CardLayout } from '../../components/card-layout'

/** Wide card pages: the public privacy request form (sc_41, 640 px). */
export default function WideCardPagesLayout({ children }: { readonly children: ReactNode }) {
  return <CardLayout wide>{children}</CardLayout>
}
