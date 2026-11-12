import type { ReactNode } from 'react'
import { AppShell } from '../../../components/app-shell'

/** Vendor operations console (vendor realm, desktop only): pages under app/(vendor)/vendor/. No tenant data routes. */
export default function VendorLayout({ children }: { readonly children: ReactNode }) {
  return <AppShell realm="vendor">{children}</AppShell>
}
