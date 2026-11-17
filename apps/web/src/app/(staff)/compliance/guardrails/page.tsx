import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { GuardrailsPage } from '../../../../features/guardrails/guardrails-page'

export const metadata: Metadata = { title: 'Guardrails' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading guardrail decisions" />}>
      <GuardrailsPage />
    </Suspense>
  )
}
