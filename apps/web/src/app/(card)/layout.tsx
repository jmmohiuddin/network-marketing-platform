import type { ReactNode } from 'react'
import { CardLayout } from '../../components/card-layout'

/** Card pages: sign-in, MFA, invitation and the role-home redirect. */
export default function CardPagesLayout({ children }: { readonly children: ReactNode }) {
  return <CardLayout>{children}</CardLayout>
}
