import { BlockList, isIP } from 'node:net'

// D-B1-09 / SEC-39: webhook egress reaches public internet addresses only. IANA special-purpose registries plus
// multicast and reserved space. Embedded IPv4 (IPv4-mapped, NAT64, 6to4) is judged by the IPv4 address it carries.
const IPV4_BLOCKED: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // this network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation TEST-NET-2
  ['203.0.113.0', 24], // documentation TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
]

const IPV6_BLOCKED: readonly (readonly [string, number])[] = [
  ['::', 8], // unspecified, loopback, IPv4-compatible and the rest of the reserved 0000::/8
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID, benchmarking)
  ['2001:db8::', 32], // documentation
  ['3fff::', 20], // documentation
  ['5f00::', 16], // SRv6 SIDs
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
]

// One list per family: node matches IPv4 addresses against IPv6 rules too (as IPv4-mapped), so ::/8 would block all.
const BLOCKED_V4 = new BlockList()
const BLOCKED_V6 = new BlockList()
for (const [network, prefix] of IPV4_BLOCKED) BLOCKED_V4.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of IPV6_BLOCKED) BLOCKED_V6.addSubnet(network, prefix, 'ipv6')

const HEXTETS = 8
const MAPPED_MARKER = 0xffff
const NAT64_PREFIX = [0x64, 0xff9b, 0, 0, 0, 0] as const
const SIX_TO_FOUR = 0x2002

/** The 8 hextets of a valid IPv6 address (dotted IPv4 tail included). */
function hextets(address: string): number[] {
  let text = address
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1]
  if (dotted !== undefined) {
    const [a, b, c, d] = dotted.split('.').map(Number) as [number, number, number, number]
    text = `${text.slice(0, -dotted.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head = '', tail] = text.split('::')
  const parse = (part: string): number[] => (part === '' ? [] : part.split(':').map((group) => Number.parseInt(group, 16)))
  const left = parse(head)
  const right = tail === undefined ? [] : parse(tail)
  return [...left, ...Array<number>(HEXTETS - left.length - right.length).fill(0), ...right]
}

const ipv4Of = (high: number, low: number): string => [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')

/** The IPv4 address carried by an IPv4-mapped, NAT64 (64:ff9b::/96) or 6to4 (2002::/16) address, else null. */
export function embeddedIpv4(address: string): string | null {
  const h = hextets(address)
  if (h.slice(0, 5).every((group) => group === 0) && h[5] === MAPPED_MARKER) return ipv4Of(h[6]!, h[7]!)
  if (NAT64_PREFIX.every((group, index) => h[index] === group)) return ipv4Of(h[6]!, h[7]!)
  if (h[0] === SIX_TO_FOUR) return ipv4Of(h[1]!, h[2]!)
  return null
}

/** True only for a unicast address on the public internet (anything unparsable is not). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !BLOCKED_V4.check(address, 'ipv4')
  if (family !== 6 || address.includes('%')) return false // a zone index means a link-local scope
  const embedded = embeddedIpv4(address)
  return embedded === null ? !BLOCKED_V6.check(address, 'ipv6') : isPublicAddress(embedded)
}

export type UrlRefusal = 'INVALID_URL' | 'NOT_HTTPS' | 'USERINFO' | 'PORT_NOT_ALLOWED' | 'ADDRESS_BLOCKED' | 'NAME_BLOCKED'

export type UrlCheck =
  | { readonly ok: true; readonly url: URL; readonly host: string; readonly port: number }
  | { readonly ok: false; readonly reason: UrlRefusal; readonly message: string }

const HTTPS_PORT = 443
const BLOCKED_NAME_SUFFIXES = ['.localhost', '.local', '.internal']

const refuse = (reason: UrlRefusal, message: string): UrlCheck => ({ ok: false, reason, message })

/** URL host without IPv6 brackets or a trailing dot, lower case. */
export const hostOf = (url: URL): string => url.hostname.replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '').toLowerCase()

/**
 * Save-time rules for a webhook URL (AC-INT1-2): https, an allowed port, no user info, no IP literal in a blocked
 * range and no local-only name. Names are resolved and checked again at every delivery (DNS can change).
 */
export function checkWebhookUrl(raw: string, allowedPorts: readonly number[]): UrlCheck {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return refuse('INVALID_URL', 'The URL is not valid.')
  }
  if (url.protocol !== 'https:') return refuse('NOT_HTTPS', 'Webhook URLs must use https.')
  if (url.username !== '' || url.password !== '') return refuse('USERINFO', 'Webhook URLs must not contain a user name or password.')
  const port = url.port === '' ? HTTPS_PORT : Number(url.port)
  if (!allowedPorts.includes(port)) return refuse('PORT_NOT_ALLOWED', `Webhook URLs may use port ${allowedPorts.join(', ')} only.`)
  const host = hostOf(url)
  if (isIP(host) !== 0) {
    return isPublicAddress(host) ? { ok: true, url, host, port } : refuse('ADDRESS_BLOCKED', 'The address is not on the public internet.')
  }
  if (host === 'localhost' || BLOCKED_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return refuse('NAME_BLOCKED', 'The host name is local-only.')
  }
  return { ok: true, url, host, port }
}
