import type { ReactNode } from 'react'

/** T4 centred card: sign-in, MFA, invitation and the role-home redirect. */
export default function CardLayout({ children }: { readonly children: ReactNode }) {
  return (
    <main className="card-page">
      <div className="card">{children}</div>
    </main>
  )
}
