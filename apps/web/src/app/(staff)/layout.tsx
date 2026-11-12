import type { ReactNode } from 'react'
import { AppShell } from '../../components/app-shell'

/** Staff application (tenant realm): every staff page lives under app/(staff)/ at its navigation path. */
export default function StaffLayout({ children }: { readonly children: ReactNode }) {
  return <AppShell realm="tenant">{children}</AppShell>
}
