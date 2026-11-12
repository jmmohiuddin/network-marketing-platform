import { Icon } from './icon'

export type StepStatus = 'done' | 'current' | 'blocked' | 'todo'

export interface Step {
  readonly label: string
  readonly status: StepStatus
  /** One line under the label; for a blocked step, why. */
  readonly detail?: string
}

const STATUS_TEXT: Readonly<Record<StepStatus, string>> = { done: 'done', current: 'current step', blocked: 'blocked', todo: 'to do' }
const CARD: Readonly<Record<StepStatus, string>> = {
  done: 'bg-surface-container-low',
  current: 'bg-primary-container text-on-primary shadow-sm',
  blocked: 'bg-error-container/40',
  todo: 'bg-surface-container',
}
const DOT: Readonly<Record<StepStatus, string>> = {
  done: 'bg-tertiary-container text-on-tertiary',
  current: 'bg-on-primary text-primary font-bold',
  blocked: 'bg-error text-on-error',
  todo: 'bg-surface-container-high text-secondary',
}

/** sc_16 l.51 step pipeline: horizontal from md, stacked (vertical) on phones. Status is text, not only colour. */
export function Stepper({ label, steps }: { readonly label: string; readonly steps: readonly Step[] }) {
  return (
    <ol aria-label={label} className="grid grid-cols-1 md:grid-flow-col md:auto-cols-fr gap-space-xs bg-surface-container-lowest rounded-lg p-space-sm shadow-sm">
      {steps.map((step, index) => {
        const current = step.status === 'current'
        return (
          <li key={step.label} aria-current={current ? 'step' : undefined} className={`flex items-start gap-space-xs p-space-xs rounded ${CARD[step.status]}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-data-mono-sm text-[12px] ${DOT[step.status]}`}>
              {step.status === 'done' ? <Icon name="check" size={14} /> : step.status === 'blocked' ? <Icon name="block" size={14} /> : index + 1}
            </span>
            <span className="flex flex-col min-w-0">
              <span className={`font-caption text-caption font-medium ${current ? 'text-primary-fixed' : 'text-secondary'}`}>
                Step {index + 1} · {STATUS_TEXT[step.status]}
              </span>
              <span className={`font-body-sm text-body-sm font-semibold ${current ? 'text-on-primary' : 'text-on-surface'}`}>{step.label}</span>
              {step.detail !== undefined && <span className={`font-data-mono-sm text-data-mono-sm ${current ? 'text-primary-fixed' : step.status === 'blocked' ? 'text-on-error-container' : 'text-secondary'}`}>{step.detail}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
