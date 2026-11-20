// T-BM-31 (PLAN B-MKT D-BM-11, section 2.5, AC-DIST7-1/-2/-4): the portal locale on GET /v1/me, PUT /v1/me/locale and the
// portal mails (invitation in the market default, sign-in code in the user's locale), plus the catalogue release check.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant, mailsTo, ownerRows, resetApiDb,
  runQueuedJobs, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { SUPPORTED_LOCALES } from '../../lib/locale.js'
import { sendInvitationJob } from './invitations.js'
import { PORTAL_MAIL_CATALOGUES } from './mail-locale.js'
import { portalMember } from './portal-test-support.js'
import { sendSignInCodeJob } from './sign-in-codes.js'

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let de: string // {de, en}
let gb: string // {en}
let nl: string // {nl}: no catalogue
let at: string // {de-AT}
let support: TestUser
closePoolsAfterAll()

async function marketWith(tenantId: string, code: string, languages: string[]): Promise<string> {
  const id = await createMarket(tenantId, code)
  await ownerRows('UPDATE market SET languages = $2 WHERE id = $1', [id, languages])
  return id
}

async function portalUserOf(tenantId: string, marketId: string): Promise<TestUser> {
  const member = await portalMember(tenantId, marketId)
  return createPortalUser({ tenantId, participantId: member.id, email: member.email! })
}

const me = (as: TestUser, acceptLanguage?: string) =>
  call(app, { method: 'GET', url: '/v1/me', as, ...(acceptLanguage === undefined ? {} : { headers: { 'accept-language': acceptLanguage } }) })
const putLocale = (as: TestUser, body: unknown) => call(app, { method: 'PUT', url: '/v1/me/locale', as, body })
const localeOf = async (as: TestUser, acceptLanguage?: string) => {
  const { locale, locales, default_locale } = (await me(as, acceptLanguage)).json().data
  return { locale, locales, default_locale }
}
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

beforeAll(async () => {
  await resetApiDb()
  ;[acme, globex] = [await createTenant(), await createTenant()]
  de = await marketWith(acme.id, 'DE', ['de', 'en'])
  gb = await marketWith(acme.id, 'GB', ['en'])
  nl = await marketWith(acme.id, 'NL', ['nl'])
  at = await marketWith(acme.id, 'AT', ['de-AT'])
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  app = await buildTestApp({ env: { SIGN_IN_RATE_LIMIT_PER_MINUTE: '1000' } })
})

afterAll(async () => {
  await app.close()
})

describe('GET /v1/me locale (AC-DIST7-1, AC-DIST7-2)', () => {
  test('market default without a preference; Accept-Language picks among the offered locales', async () => {
    const user = await portalUserOf(acme.id, de)
    const offered = [{ code: 'de', label: 'Deutsch' }, { code: 'en', label: 'English' }]
    expect(await localeOf(user)).toEqual({ locale: 'de', locales: offered, default_locale: 'de' })
    expect(await localeOf(user, 'en-GB,en;q=0.9,de;q=0.5')).toEqual({ locale: 'en', locales: offered, default_locale: 'de' })
    expect((await localeOf(user, 'fr-FR')).locale).toBe('de')
  })

  test('region tags count by primary subtag; a language without catalogue falls back to English', async () => {
    expect(await localeOf(await portalUserOf(acme.id, at), 'en')).toEqual({ locale: 'de', locales: [{ code: 'de', label: 'Deutsch' }], default_locale: 'de' })
    expect(await localeOf(await portalUserOf(acme.id, nl), 'nl')).toEqual({ locale: 'en', locales: [{ code: 'en', label: 'English' }], default_locale: 'en' })
  })

  test('staff sessions get no locale fields', async () => {
    const data = (await me(support)).json().data
    expect(data).not.toHaveProperty('locale')
    expect(data).not.toHaveProperty('locales')
  })
})

describe('PUT /v1/me/locale (AC-DIST7-1)', () => {
  test('persists an offered locale, audited; the preference wins over Accept-Language', async () => {
    const user = await portalUserOf(acme.id, de)
    const response = await putLocale(user, { locale: 'en' })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({ locale: 'en' })
    expect((await localeOf(user, 'de')).locale).toBe('en')
    expect(await ownerRows('SELECT locale FROM user_account WHERE id = $1', [user.id])).toEqual([{ locale: 'en' }])
    expect(await ownerRows(
      `SELECT object_id, after_ref::jsonb -> 'after' AS after FROM audit.audit_event WHERE action = 'PORTAL_LOCALE.CHANGED' AND actor_id = $1`, [user.id],
    )).toEqual([{ object_id: user.id, after: { user_id: user.id } }])
  })

  test('a supported but not offered or unsupported locale is 422 LOCALE_NOT_OFFERED; a malformed body 400', async () => {
    const user = await portalUserOf(acme.id, gb)
    for (const locale of ['de', 'fr']) {
      const response = await putLocale(user, { locale })
      expect([response.statusCode, response.json().error.code, response.json().error.details]).toEqual([422, 'LOCALE_NOT_OFFERED', { offered: ['en'] }])
    }
    expect((await putLocale(user, { locale: 'deu' })).statusCode).toBe(400)
    expect((await putLocale(user, { locale: 'de', extra: true })).statusCode).toBe(400)
    expect((await putLocale(user, {})).statusCode).toBe(400)
    expect(await ownerRows('SELECT locale FROM user_account WHERE id = $1', [user.id])).toEqual([{ locale: null }])
  })

  test('staff sessions and anonymous callers are refused; another tenant\'s portal user changes only its own account', async () => {
    expect((await putLocale(support, { locale: 'en' })).statusCode).toBe(403)
    expect((await call(app, { method: 'PUT', url: '/v1/me/locale', body: { locale: 'en' } })).statusCode).toBe(401)
    const other = await portalUserOf(globex.id, await marketWith(globex.id, 'DE', ['de', 'en']))
    const own = await portalUserOf(acme.id, de)
    expect((await putLocale(other, { locale: 'en' })).statusCode).toBe(200)
    expect((await localeOf(own)).locale).toBe('de')
  })
})

describe('portal mails (AC-DIST7-4)', () => {
  test('the invitation is in the market default; the sign-in code in the user\'s locale, English by preference', async () => {
    const member = await portalMember(acme.id, de)
    expect((await call(app, { method: 'POST', url: `/v1/participants/${member.id}/portal-account`, as: support, idempotencyKey: true })).statusCode).toBe(201)
    await runQueuedJobs(sendInvitationJob)
    const [invitation] = await mailsTo(member.email!)
    expect(invitation).toContain('Subject: Ihr Konto bei')
    expect(invitation).toContain('Wählen Sie Ihr Passwort über diesen Link.')

    const german = await portalUserOf(acme.id, de)
    const english = await portalUserOf(acme.id, de)
    await putLocale(english, { locale: 'en' })
    const nlUser = await portalUserOf(acme.id, nl)
    for (const user of [german, english, nlUser]) {
      expect((await call(app, { method: 'POST', url: '/v1/auth/portal-codes', body: { tenant: acme.slug, email: user.email } })).statusCode).toBe(202)
    }
    await runQueuedJobs(sendSignInCodeJob)
    expect((await mailsTo(german.email))[0]).toMatch(/Ihr Anmeldecode lautet \d{6}\./)
    expect((await mailsTo(english.email))[0]).toMatch(/Your sign-in code is \d{6}\./)
    expect((await mailsTo(nlUser.email))[0]).toContain('Subject: Your sign-in code for')
  })

  test('release check: every locale has every en key, the same placeholders and no empty value', () => {
    const en = PORTAL_MAIL_CATALOGUES.en
    for (const locale of SUPPORTED_LOCALES) {
      const catalogue = PORTAL_MAIL_CATALOGUES[locale]
      expect(Object.keys(catalogue).sort()).toEqual(Object.keys(en).sort())
      for (const [key, text] of Object.entries(en)) {
        expect(catalogue[key]!.trim(), `${locale} ${key}`).not.toBe('')
        expect(placeholders(catalogue[key]!), `${locale} ${key}`).toEqual(placeholders(text))
      }
    }
  })
})
