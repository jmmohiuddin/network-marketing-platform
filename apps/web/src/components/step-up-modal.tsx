'use client'

import { Button } from './button'
import { CodeInput } from './code-input'
import { Icon } from './icon'
import { Modal } from './modal'

export interface StepUpModalProps {
  readonly open: boolean
  /** true: the code was verified; false: the user cancelled. */
  readonly onDone: (verified: boolean) => void
}

/**
 * Fresh second factor before a sensitive action (sc_02-modal step-up block, TOTP instead of the drawn hardware key:
 * the API supports TOTP only). Opened by ApiProvider on STEP_UP_REQUIRED; the action is then retried once.
 */
export function StepUpModal({ open, onDone }: StepUpModalProps) {
  return (
    <Modal open={open} onClose={() => onDone(false)} title="Confirm with your authenticator app" icon="lock" size="sm">
      <p className="font-body-sm text-body-sm text-on-surface-variant">This action needs a fresh code from your authenticator app. Nothing has been changed yet.</p>
      <div className="bg-surface-container-low rounded-lg p-space-md space-y-space-md">
        <div className="flex items-center gap-space-xs">
          <Icon name="pin" size={18} className="text-primary" />
          <span className="font-section-heading text-caption uppercase tracking-wider font-bold text-on-surface">Authenticator code</span>
        </div>
        <CodeInput
          idPrefix="step-up"
          endpoint="/v1/auth/sessions/current/step-up"
          submitLabel="Confirm and continue"
          onVerified={() => onDone(true)}
          secondaryAction={<Button onClick={() => onDone(false)} className="w-full">Cancel</Button>}
        />
      </div>
    </Modal>
  )
}
