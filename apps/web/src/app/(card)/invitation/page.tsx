import type { Metadata } from 'next'
import { InvitationForm } from '../../../features/auth/invitation-form'

export const metadata: Metadata = { title: 'Choose your password' }

export default function InvitationPage() {
  return <InvitationForm />
}
