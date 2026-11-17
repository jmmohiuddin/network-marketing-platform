// AC-PAR1-3: contact data leaves masked unless unmasked with participant.unmask and a fresh second factor. One format for
// every surface that shows a participant's contact (PAR participants, GEN downline).
export const CONTACT_FIELDS = ['email', 'phone', 'address'] as const
export type ContactField = (typeof CONTACT_FIELDS)[number]
export type Contact = Partial<Record<ContactField, string>>

const DOTS = '•••'

/** j•••@e•••.com: first letter of the mailbox and of the domain, the top-level domain. */
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  const labels = domain.split('.')
  const tld = labels.length > 1 ? `.${labels.at(-1)}` : ''
  return `${local.slice(0, 1)}${DOTS}@${domain.slice(0, 1)}${DOTS}${tld}`
}

/** •••• 1234: the last four digits only. */
function maskPhone(phone: string): string {
  return `•••• ${phone.replace(/\D/g, '').slice(-4)}`
}

export function maskContact(contact: Contact | null): Contact | null {
  if (contact === null) return null
  return {
    ...(contact.email === undefined ? {} : { email: maskEmail(contact.email) }),
    ...(contact.phone === undefined ? {} : { phone: maskPhone(contact.phone) }),
    ...(contact.address === undefined ? {} : { address: DOTS }),
  }
}
