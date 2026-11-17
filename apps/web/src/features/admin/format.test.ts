import { describe, expect, it } from 'vitest'
import {
  BASE_ROLE_PERMISSIONS, durationLabel, fromLocalInput, isUuid, marketScopeLabel, permissionLabel, remainingLabel, requestableScopes, supportApproverRoles,
  supportApproverText, supportScopeLabel, toLocalInput, unapprovableAreas,
} from './format'

describe('admin format helpers', () => {
  it('writes durations in hours and minutes', () => {
    expect(durationLabel(45)).toBe('45 min')
    expect(durationLabel(240)).toBe('4 h')
    expect(durationLabel(90)).toBe('1 h 30 min')
  })

  it('counts down to the end of a session, rounding up to the minute', () => {
    const now = Date.parse('2026-11-12T10:00:00Z')
    expect(remainingLabel('2026-11-12T12:41:00Z', now, null)).toBe('2 h 41 min')
    expect(remainingLabel('2026-11-12T10:00:30Z', now, null)).toBe('1 min')
    expect(remainingLabel('2026-11-12T09:59:00Z', now, null)).toBe('Ended')
  })

  it('never states more time left than the session window, even with a clock that lags (BUG-038)', () => {
    // A 60-minute session approved 19 s after the page's clock last ticked.
    const now = Date.parse('2026-11-12T03:33:00.000Z')
    expect(remainingLabel('2026-11-12T04:33:19.885Z', now, '2026-11-12T03:33:19.885Z')).toBe('1 h')
    expect(remainingLabel('2026-11-12T04:33:19.885Z', Date.parse('2026-11-12T03:43:19.885Z'), '2026-11-12T03:33:19.885Z')).toBe('50 min')
  })

  it('round-trips datetime-local values through ISO timestamps', () => {
    const iso = fromLocalInput('2026-11-12T09:30')
    expect(iso).not.toBeNull()
    expect(toLocalInput(iso!)).toBe('2026-11-12T09:30')
    expect(fromLocalInput('')).toBeNull()
    expect(toLocalInput('not a date')).toBe('')
  })

  it('names market scopes without inventing market names', () => {
    expect(marketScopeLabel(null)).toBe('All markets')
    expect(marketScopeLabel(['a'])).toBe('1 market')
    expect(marketScopeLabel(['a', 'b'])).toBe('2 markets')
    const markets = [{ id: 'a', code: 'DE' }, { id: 'b', code: 'FR' }]
    expect(marketScopeLabel(['a', 'b'], markets)).toBe('DE, FR')
    expect(marketScopeLabel(['a', 'c'], markets)).toBe('2 markets')
  })

  it('recognises ids', () => {
    expect(isUuid('0b9e6c1a-1f2d-4c3b-9a8e-7d6c5b4a3f21')).toBe(true)
    expect(isUuid('0b9e6c1a')).toBe(false)
  })

  it('labels the B1 permissions', () => {
    expect(permissionLabel('settings.approve')).toBe('Approve money settings')
    expect(permissionLabel('market.manage')).toBe('Prepare market launches')
    expect(permissionLabel('market.signoff')).toBe('Sign off market launches')
    expect(permissionLabel('integration.manage')).toBe('Manage API keys and webhooks')
    expect(supportScopeLabel('market.manage')).toBe('Market launches')
  })

  it('labels the 18 B2 permissions (PLAN B2 section 3)', () => {
    const labels = {
      'participant.read': 'View participants', 'participant.manage': 'Enrol and manage participants',
      'participant.terminate': 'Terminate positions', 'participant_type.approve': 'Approve participant types',
      'agreement.publish': 'Publish agreement versions', 'genealogy.read': 'View genealogy',
      'case.genealogy.read': 'View genealogy cases', 'case.genealogy.create': 'File genealogy cases',
      'case.genealogy.approve': 'Approve genealogy cases', 'case.duplicate.read': 'View duplicate cases',
      'case.duplicate.create': 'Investigate duplicates', 'case.duplicate.approve': 'Decide duplicate cases',
      'servicing.manage': 'Manage customer servicing', 'order.read': 'View orders', 'product.manage': 'Manage product volumes',
      'late.manage': 'Decide late transactions', 'integration.read': 'View integration health', 'privacy.manage': 'Approve privacy policies',
    }
    expect(Object.fromEntries(Object.keys(labels).map((permission) => [permission, permissionLabel(permission)]))).toEqual(labels)
  })

  it('names the read-only B2 support areas and only those (support/sessions.ts exclusions)', () => {
    expect(['participant.read', 'genealogy.read', 'case.genealogy.read', 'case.duplicate.read', 'order.read', 'integration.read'].map(supportScopeLabel))
      .toEqual(['Participants', 'Genealogy', 'Genealogy cases', 'Duplicate cases', 'Orders', 'Integration health'])
    for (const writeOnly of ['participant.manage', 'servicing.manage', 'late.manage', 'privacy.manage']) expect(supportScopeLabel(writeOnly)).toBe(writeOnly)
  })

  it('carries the B2 base-role permissions (permissions.ts BASE_ROLES)', () => {
    expect(BASE_ROLE_PERMISSIONS['Support agent']).toEqual([
      'participant.read', 'participant.manage', 'genealogy.read', 'case.genealogy.read', 'case.genealogy.create',
      'case.duplicate.read', 'case.duplicate.create', 'servicing.manage', 'order.read',
    ])
    expect(BASE_ROLE_PERMISSIONS.DPO).toEqual(['compliance.read', 'audit.read', 'participant.unmask', 'participant.read', 'privacy.manage'])
    expect(BASE_ROLE_PERMISSIONS['Compliance officer']).toContain('participant.terminate')
    expect(BASE_ROLE_PERMISSIONS['Tenant admin']).toEqual(expect.arrayContaining(['participant.read', 'order.read', 'product.manage', 'integration.read']))
    expect(BASE_ROLE_PERMISSIONS['Commission analyst']).toContain('late.manage')
    expect(BASE_ROLE_PERMISSIONS['Payout officer']).toEqual(['participant.unmask', 'participant.read'])
    expect(BASE_ROLE_PERMISSIONS['Finance approver']).toEqual(expect.arrayContaining(['participant.read', 'order.read']))
  })

  it('BUG-048: never offers compensation plans as a support area', () => {
    expect(requestableScopes(['audit.read', 'plan.activate', 'market.manage'])).toEqual(['audit.read', 'market.manage'])
    expect(supportScopeLabel('plan.activate')).toBe('plan.activate')
  })

  it('BUG-047: names the base roles that can approve each support area', () => {
    expect(supportApproverRoles('audit.read')).toEqual(['Tenant admin'])
    expect(supportApproverRoles('export')).toEqual([])
    expect(supportApproverText('audit.read')).toBe('Approved by: Tenant admin')
    expect(supportApproverText('snapshot.create')).toMatch(/^No base role can approve this/)
  })

  it('BUG-047: lists the areas the user cannot approve over all markets', () => {
    const admin = { permissions: ['audit.read', 'user.manage', 'vendor_access.decide'], roles: [{ name: 'Tenant admin', market_ids: null }] }
    expect(unapprovableAreas(admin, ['audit.read', 'export'])).toEqual(['export'])
    const scoped = {
      permissions: ['audit.read', 'vendor_access.decide', 'export'],
      roles: [{ name: 'Tenant admin', market_ids: null }, { name: 'Compliance officer', market_ids: ['m1'] }],
    }
    expect(unapprovableAreas(scoped, ['audit.read', 'export'])).toEqual(['export'])
  })
})
