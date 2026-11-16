import { createSocket, type Socket } from 'node:dgram'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { dnsResolver } from './transport.js'

// A DNS server that never answers.
let silent: Socket

beforeAll(async () => {
  silent = createSocket('udp4')
  await new Promise<void>((resolve) => silent.bind(0, '127.0.0.1', resolve))
})

afterAll(() => {
  silent.close()
})

describe('dnsResolver', () => {
  test('a host whose DNS does not answer fails at the deadline', async () => {
    const resolve = dnsResolver({ deadlineMs: 300, servers: [`127.0.0.1:${(silent.address() as AddressInfo).port}`] })
    const started = Date.now()

    await expect(resolve('hooks.example.com')).rejects.toMatchObject({ code: 'ECANCELLED' })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  test('an IP literal is its own address, without a query', async () => {
    const resolve = dnsResolver({ deadlineMs: 300, servers: [`127.0.0.1:${(silent.address() as AddressInfo).port}`] })

    expect(await resolve('2001:db8::1')).toEqual([{ address: '2001:db8::1', family: 6 }])
    expect(await resolve('93.184.216.34')).toEqual([{ address: '93.184.216.34', family: 4 }])
  })
})
