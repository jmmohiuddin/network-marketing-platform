'use client'

import { useState } from 'react'
import { Button } from '../../../components/button'
import { TextField } from '../../../components/form-field'
import { emailError, requiredError } from '../../../lib/validation'
import type { BreachContact } from '../types'
import { SettingDialog } from './setting-dialog'
import type { ThresholdDialogProps } from './threshold-dialogs'

const MAX_CONTACTS = 20
const TEXT_MAX = 200
const EMAIL_MAX = 320
const PHONE = /^\+?[0-9 ()-]{5,40}$/ // as the API's breachContact schema (ten/settings.ts)
const FIELDS = ['name', 'role', 'email', 'phone'] as const
type ContactField = (typeof FIELDS)[number]

interface ContactRow extends BreachContact {
  readonly id: number
}

const fieldId = (index: number, field: ContactField) => `contact-${index}-${field}`

function contactFieldError(field: ContactField, value: string): string | null {
  switch (field) {
    case 'name':
      return requiredError('the contact’s name', value)
    case 'role':
      return requiredError('the contact’s role, for example Data protection officer', value)
    case 'email':
      return requiredError('the contact’s email address', value) ?? emailError(value)
    case 'phone':
      return requiredError('the contact’s phone number', value) ?? (PHONE.test(value.trim()) ? null : 'Enter a phone number, for example +44 20 7946 0000.')
  }
}

/** Field errors by field id, at least one contact (FR-PRV-004). */
export function checkContacts(rows: readonly BreachContact[]): Record<string, string> {
  if (rows.length === 0) return { 'contact-add': 'Add at least one contact.' }
  return Object.fromEntries(rows.flatMap((row, index) => FIELDS.flatMap((field) => {
    const error = contactFieldError(field, row[field])
    return error === null ? [] : [[fieldId(index, field), error]]
  })))
}

const LABELS: Readonly<Record<ContactField, string>> = { name: 'Name', role: 'Role', email: 'Email address', phone: 'Phone number' }

/** FR-PRV-004 breach-notification contacts (privacy.breach_contacts); saving needs a fresh second factor. */
export function BreachContactsDialog({ current, ...props }: ThresholdDialogProps<readonly BreachContact[]>) {
  const [rows, setRows] = useState<readonly ContactRow[]>(() => (current ?? []).map((contact, id) => ({ ...contact, id })))
  const [nextId, setNextId] = useState(rows.length)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const update = (id: number, field: ContactField, value: string) =>
    setRows((list) => list.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
  function add() {
    setRows((list) => [...list, { id: nextId, name: '', role: '', email: '', phone: '' }])
    setNextId((id) => id + 1)
  }
  function build() {
    const found = checkContacts(rows)
    setErrors(found)
    const items = Object.entries(found).map(([id, message]) => ({ fieldId: id, message }))
    if (items.length > 0) return { items }
    return { value: rows.map(({ name, role, email, phone }) => ({ name: name.trim(), role: role.trim(), email: email.trim(), phone: phone.trim() })), items }
  }
  return (
    <SettingDialog {...props} settingKey="privacy.breach_contacts" build={build}>
      <p>The people to notify when personal data may have been breached. Your vendor’s operations staff can read this list.</p>
      {rows.map((row, index) => (
        <fieldset key={row.id} className="admin-group admin-fieldset">
          <legend>Contact {index + 1}</legend>
          <div className="admin-pair">
            {FIELDS.map((field) => (
              <TextField
                key={field}
                id={fieldId(index, field)}
                label={LABELS[field]}
                type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
                maxLength={field === 'email' ? EMAIL_MAX : TEXT_MAX}
                value={row[field]}
                error={errors[fieldId(index, field)]}
                onChange={(event) => update(row.id, field, event.target.value)}
              />
            ))}
          </div>
          <div className="form-actions">
            <Button variant="tertiary" onClick={() => setRows((list) => list.filter((other) => other.id !== row.id))}>Remove contact {index + 1}</Button>
          </div>
        </fieldset>
      ))}
      {rows.length < MAX_CONTACTS && <div><Button id="contact-add" onClick={add}>Add contact</Button></div>}
      <p className="admin-note">Saving asks for a code from your authenticator app.</p>
    </SettingDialog>
  )
}
