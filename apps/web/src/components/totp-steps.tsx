'use client'

import type { ReactNode } from 'react'
import { CodeInput } from './code-input'
import { QrCode } from './qr-code'
import { SecretText } from './secret-text'

/** POST /v1/auth/mfa/totp: shown once; the API keeps only the sealed secret. */
export interface TotpEnrolment {
  readonly secret: string
  readonly otpauth_uri: string
}

export const TOTP_ENROL_PATH = '/v1/auth/mfa/totp'

/** One enrolment step in the sc_27 inner-panel look (bg-surface-container-low, rounded-lg). */
function EnrolStep({ number, title, text, children }: { readonly number: number; readonly title: string; readonly text?: string; readonly children: ReactNode }) {
  return (
    <li className="p-space-md bg-surface-container-low rounded-lg flex flex-col gap-space-sm">
      <div className="flex items-center gap-space-sm">
        <span aria-hidden="true" className="w-6 h-6 rounded bg-primary text-on-primary flex items-center justify-center font-caption text-caption font-bold shrink-0">{number}</span>
        <h2 className="font-section-heading text-section-heading text-on-surface">{title}</h2>
      </div>
      {text !== undefined && <p className="font-body-sm text-body-sm text-on-surface-variant">{text}</p>}
      {children}
    </li>
  )
}

/**
 * Scan (or type) the new secret, then confirm the app's code (POST /v1/auth/mfa/totp/confirm): the session is then
 * verified with a fresh step-up time. Used by the enrolment page and by the step-up dialog (BUG-110).
 */
export function TotpSteps({ enrolment, idPrefix, onVerified, secondaryAction }: {
  readonly enrolment: TotpEnrolment
  readonly idPrefix: string
  readonly onVerified: () => void
  readonly secondaryAction?: ReactNode
}) {
  return (
    <ol className="flex flex-col gap-space-md">
      <EnrolStep number={1} title="Scan the QR code" text="In your authenticator app, add an account and scan this code.">
        <div className="flex justify-center">
          <QrCode value={enrolment.otpauth_uri} label="QR code that adds this account to your authenticator app. The same key is shown as text below." />
        </div>
      </EnrolStep>
      <EnrolStep number={2} title="Or type the setup key" text="If you cannot scan, add the account by typing this key. Do not share it.">
        <SecretText label="Setup key" value={enrolment.secret} />
      </EnrolStep>
      <EnrolStep number={3} title="Enter the code from the app">
        <CodeInput idPrefix={idPrefix} endpoint={`${TOTP_ENROL_PATH}/confirm`} submitLabel="Confirm code" onVerified={onVerified} secondaryAction={secondaryAction} />
      </EnrolStep>
    </ol>
  )
}
