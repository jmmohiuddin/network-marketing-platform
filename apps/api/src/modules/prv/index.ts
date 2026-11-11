import { z } from 'zod'
import { requireRealm } from '../../lib/auth.js'
import { envelope, parse } from '../../lib/http.js'
import type { ApiModule } from '../../lib/module.js'
import { readBreachContactsAsVendor } from './breach-contacts.js'

const idParams = z.object({ id: z.uuid() })

/**
 * Privacy (FR-PRV-004): breach-notification contacts. Tenant admins edit them as tenant setting
 * privacy.breach_contacts (ten module); vendor operations read them here; other modules gate go-live and
 * the first data load with assertBreachContactRecorded.
 */
export const prvModule: ApiModule = {
  name: 'prv',
  register(app) {
    app.get('/v1/tenants/:id/breach-contacts', { preHandler: [requireRealm('vendor')] }, async (request) => {
      const { id } = parse(idParams, request.params)
      return envelope({ contacts: await readBreachContactsAsVendor(request, id) })
    })
  },
}

export { assertBreachContactRecorded, breachContacts, type BreachContacts } from './breach-contacts.js'
