import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { refusalText } from './format'

// BUG-081: a refusal code raised by a storefront connector without words in REFUSAL_LABELS shows raw in the exception
// queue and in sync health. Static scan of the API files that raise them, so a new code fails here first.
describe('storefront refusal codes', () => {
  it('has words for every refusal code api/modules/int/{shopify,woocommerce,mapping}.ts raises', () => {
    const codes = ['shopify', 'woocommerce', 'mapping'].flatMap((file) => {
      const source = readFileSync(new URL(`../../../../api/src/modules/int/${file}.ts`, import.meta.url), 'utf8')
      return [...source.matchAll(/(?:MappingRefusal|ApiError)\([^'"]*['"]([A-Z][A-Z0-9_]+)['"]/g)].map((match) => match[1]!)
    })
    expect(codes).toEqual(expect.arrayContaining(['BUYER_MISSING', 'SKU_MISSING', 'AMOUNT_INVALID', 'AMOUNT_PRECISION', 'PAYLOAD_INVALID']))
    expect(codes.filter((code) => refusalText(code) === code)).toEqual([])
  })
})
