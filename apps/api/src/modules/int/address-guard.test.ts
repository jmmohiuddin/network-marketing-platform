import { describe, expect, test } from 'vitest'
import { checkWebhookUrl, embeddedIpv4, isPublicAddress } from './address-guard.js'
import { retryDelayMs } from './dispatch.js'

describe('T-B1-18 address blocklist', () => {
  test.each([
    '0.0.0.0', '10.0.0.5', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.8',
    '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.250', '240.0.0.1',
    '255.255.255.255',
  ])('IPv4 %s is blocked', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  test.each([
    '::', '::1', '::127.0.0.1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%en0', 'fec0::1', 'ff02::1', '2001:db8::1',
    '2001::1', '3fff::1', '100::1', '64:ff9b:1::a00:1', '5f00::1',
  ])('IPv6 %s is blocked', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  test.each([
    ['::ffff:127.0.0.1', '127.0.0.1'], ['::ffff:7f00:1', '127.0.0.1'], ['::ffff:169.254.169.254', '169.254.169.254'],
    ['64:ff9b::a00:5', '10.0.0.5'], ['64:ff9b::192.168.0.1', '192.168.0.1'], ['2002:a9fe:a9fe::1', '169.254.169.254'],
    ['2002:7f00:1::', '127.0.0.1'],
  ])('embedded IPv4 in %s (%s) is judged as IPv4 and blocked', (address, ipv4) => {
    expect(embeddedIpv4(address)).toBe(ipv4)
    expect(isPublicAddress(address)).toBe(false)
  })

  test.each(['8.8.8.8', '93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4001::200e', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1'])(
    '%s is public', (address) => {
      expect(isPublicAddress(address)).toBe(true)
    },
  )

  test('anything that is not an IP address is not public', () => {
    expect(isPublicAddress('localhost')).toBe(false)
    expect(isPublicAddress('')).toBe(false)
  })
})

describe('T-B1-18 webhook URL rules (AC-INT1-2)', () => {
  const ports = [443]
  test.each([
    ['http://hooks.example.com/x', 'NOT_HTTPS'],
    ['https://127.0.0.1/x', 'ADDRESS_BLOCKED'],
    ['https://[::1]/x', 'ADDRESS_BLOCKED'],
    ['https://[::ffff:10.0.0.1]/x', 'ADDRESS_BLOCKED'],
    ['https://169.254.169.254/latest/meta-data', 'ADDRESS_BLOCKED'],
    ['https://10.0.0.5/x', 'ADDRESS_BLOCKED'],
    ['https://0x7f.1/x', 'ADDRESS_BLOCKED'],
    ['https://localhost/x', 'NAME_BLOCKED'],
    ['https://api.localhost/x', 'NAME_BLOCKED'],
    ['https://printer.local/x', 'NAME_BLOCKED'],
    ['https://x.internal/x', 'NAME_BLOCKED'],
    ['https://X.INTERNAL./x', 'NAME_BLOCKED'],
    ['https://h:8080/x', 'PORT_NOT_ALLOWED'],
    ['https://user:pass@hooks.example.com/x', 'USERINFO'],
    ['https://user@hooks.example.com/x', 'USERINFO'],
    ['not a url', 'INVALID_URL'],
  ])('%s is refused: %s', (url, reason) => {
    const check = checkWebhookUrl(url, ports)
    expect(check.ok).toBe(false)
    expect(check.ok ? null : check.reason).toBe(reason)
  })

  test('a public https name or address on an allowed port is accepted', () => {
    expect(checkWebhookUrl('https://hooks.example.com/nmp?x=1', ports)).toMatchObject({ ok: true, host: 'hooks.example.com', port: 443 })
    expect(checkWebhookUrl('https://93.184.216.34/x', ports)).toMatchObject({ ok: true, host: '93.184.216.34' })
    expect(checkWebhookUrl('https://hooks.example.com:8443/x', [443, 8443])).toMatchObject({ ok: true, port: 8443 })
    expect(checkWebhookUrl('https://hooks.example.com:443/x', ports)).toMatchObject({ ok: true, port: 443 })
  })
})

describe('T-B1-20 retry backoff', () => {
  const config = { webhookRetryBaseSeconds: 60, webhookRetryMaxSeconds: 21_600 }
  test('doubles from one minute, capped at six hours, with ±10 % jitter', () => {
    expect([1, 2, 3, 4].map((attempt) => retryDelayMs(attempt, config, 0))).toEqual([60_000, 120_000, 240_000, 480_000])
    expect(retryDelayMs(9, config, 0)).toBe(15_360_000)
    expect(retryDelayMs(10, config, 0)).toBe(21_600_000)
    expect(retryDelayMs(30, config, 0)).toBe(21_600_000)
    expect(retryDelayMs(1, config, 10)).toBe(66_000)
    expect(retryDelayMs(1, config, -10)).toBe(54_000)
  })
})
