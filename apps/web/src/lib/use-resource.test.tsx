// @vitest-environment jsdom
import '../test/dom'
import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../components/api-provider'
import { ok } from '../test/fetch'
import { useResource } from './use-resource'

const seen: string[] = []

function Probe() {
  const { data, error } = useResource<string[]>('/v1/users')
  if (error !== null) seen.push('error')
  return <p>{data === null ? 'Loading' : data.join(', ')}</p>
}

describe('useResource', () => {
  it('ignores the request React StrictMode aborts, so no error flashes before the answer', async () => {
    // A fetch that honours the signal, as browsers do: the aborted first request rejects with AbortError.
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      setTimeout(() => resolve(ok(['ada'])), 10)
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<StrictMode><ApiProvider><Probe /></ApiProvider></StrictMode>)
    expect(await screen.findByText('ada')).toBeTruthy()
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    expect(seen).toEqual([])
  })
})
