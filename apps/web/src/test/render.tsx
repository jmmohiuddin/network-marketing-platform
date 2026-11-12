import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { ApiProvider } from '../components/api-provider'
import { ToastProvider } from '../components/toast'
import type { FetchMock } from './fetch'

/** Renders under the real providers with fetch answered by fetchMock. */
export function renderWithProviders(ui: ReactElement, fetchMock: FetchMock): RenderResult {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <ToastProvider>
      <ApiProvider>{ui}</ApiProvider>
    </ToastProvider>,
  )
}
