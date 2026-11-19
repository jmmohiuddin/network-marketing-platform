import type { ReactNode } from 'react'
import { PortalShell } from '../../features/portal/shell'

/** Distributor portal (portal realm, PLAN B5 §5): every /portal page except sign-in lives under app/(portal)/portal/. */
export default function PortalLayout({ children }: { readonly children: ReactNode }) {
  return <PortalShell>{children}</PortalShell>
}
