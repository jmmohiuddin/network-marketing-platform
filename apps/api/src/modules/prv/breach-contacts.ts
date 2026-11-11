import type { Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { recordAudit, recordVendorAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { inVendorThenTenant, lockTenant } from '../support/index.js'
import { getSetting, type SettingValue } from '../ten/index.js'

export type BreachContacts = SettingValue<'privacy.breach_contacts'>

/**
 * FR-PRV-004, AC-53.1: the breach-notification contacts in force now, from tenant setting
 * privacy.breach_contacts (written by a tenant admin through PUT /v1/settings/privacy.breach_contacts, which
 * requires at least one contact). null when none is recorded. Runs in the tenant's transaction.
 */
export function breachContacts(tx: Tx): Promise<BreachContacts | null> {
  return getSetting(tx, 'privacy.breach_contacts')
}

/** AC-53.1 / MVP_A C-21: go-live and the first data load are blocked until a breach contact is recorded. */
export async function assertBreachContactRecorded(tx: Tx): Promise<void> {
  if ((await breachContacts(tx)) === null) {
    throw new ApiError(422, 'BREACH_CONTACT_REQUIRED', 'Record at least one breach-notification contact first (tenant setting privacy.breach_contacts).')
  }
}

const READ_EVENT = { action: 'BREACH_CONTACTS.READ', objectType: 'tenant' } as const

/**
 * Vendor operations read a tenant's breach contacts (FR-PRV-004 "Vendor ops reads"): logged in the vendor
 * log and, because it reads the tenant's data, in the tenant's log, in one transaction.
 */
export function readBreachContactsAsVendor(request: FastifyRequest, tenantId: string): Promise<BreachContacts | null> {
  return inVendorThenTenant(
    request,
    async (tx) => {
      const tenant = await lockTenant(tx, tenantId)
      await recordVendorAudit(tx, { ...READ_EVENT, objectId: tenant.id })
      return { tenantId: tenant.id }
    },
    async (tx) => {
      await recordAudit(tx, { ...READ_EVENT, objectId: tenantId })
      return breachContacts(tx)
    },
  )
}
