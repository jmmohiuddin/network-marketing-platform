'use client'

import { LoaderCircle } from 'lucide-react'
import Link from 'next/link'
import type { ComponentProps, MouseEvent } from 'react'

/**
 * primary: one per view. destructive: outline danger; destructive-solid only inside the destructive action's
 * own confirmation dialog (UI-01 §8). tertiary: text button.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'destructive-solid'
/** md 36px (staff); lg 44px (phones, portal). */
export type ButtonSize = 'md' | 'lg'

interface ButtonLook {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
}

export interface ButtonProps extends ComponentProps<'button'>, ButtonLook {
  /** Spinner over the label (width kept), aria-busy, clicks ignored. */
  readonly loading?: boolean
}

export type LinkButtonProps = ComponentProps<typeof Link> & ButtonLook

function buttonClass(variant: ButtonVariant, size: ButtonSize, extra: string | undefined): string {
  return ['btn', `btn-${variant}`, `btn-${size}`, extra].filter(Boolean).join(' ')
}

const ignoreClick = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault()

/** Label = verb + object ("Approve batch"), never "OK". Native <button>, type="button" unless given. */
export function Button({ variant = 'secondary', size = 'md', loading = false, type = 'button', className, children, onClick, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={buttonClass(variant, size, className)}
      aria-busy={loading || undefined}
      onClick={loading ? ignoreClick : onClick}
    >
      <span className="btn-label">{children}</span>
      {loading && <LoaderCircle className="btn-spinner" size={16} aria-hidden="true" />}
    </button>
  )
}

/** A link that looks like a button (navigation, not an action). */
export function LinkButton({ variant = 'secondary', size = 'md', className, ...rest }: LinkButtonProps) {
  return <Link {...rest} className={buttonClass(variant, size, className)} />
}
