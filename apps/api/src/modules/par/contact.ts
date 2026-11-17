import type { Contact } from '../../lib/contact.js'

export { CONTACT_FIELDS, maskContact, type Contact, type ContactField } from '../../lib/contact.js'

/** The stored contact without empty fields, or null (nothing to store). */
export function storedContact(contact: Contact | undefined): Contact | null {
  const entries = Object.entries(contact ?? {}).filter(([, value]) => value !== undefined)
  return entries.length === 0 ? null : Object.fromEntries(entries)
}
