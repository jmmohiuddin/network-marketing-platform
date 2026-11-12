'use client'

import Link from 'next/link'
import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { Icon } from './icon'

/**
 * primary: one per view. destructive: tinted danger; destructive-solid only inside the destructive action's own
 * confirmation dialog. tertiary: text button. Classes from sc_01 (primary, secondary), sc_02-modal (tertiary),
 * sc_03 (destructive).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'destructive-solid'
/** sm 28 px (table rows), md 32 px (staff), lg 44 px (card layout, portal, phones). */
export type ButtonSize = 'sm' | 'md' | 'lg'

/** Visible keyboard focus where Stitch removes the outline (guidelines §6.9). */
export const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

const BASE = `relative inline-flex items-center justify-center gap-space-xs rounded font-body-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS_RING}`

const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-primary hover:bg-primary-container text-on-primary font-semibold shadow-sm',
  secondary: 'bg-surface-container hover:bg-surface-container-high text-on-surface font-medium',
  // min-w-6: a short text button ("#61") still meets the 24 px staff target (guidelines 6.9, WCAG 2.5.8; BUG-040).
  tertiary: 'text-primary hover:underline font-semibold min-w-6',
  destructive: 'bg-error-container hover:bg-red-100 text-error font-semibold',
  'destructive-solid': 'bg-error hover:bg-on-error-container text-on-error font-semibold shadow-sm',
}

const HEIGHT: Readonly<Record<ButtonSize, string>> = { sm: 'h-7 text-[11px]', md: 'h-8 text-body-sm', lg: 'h-11 text-section-heading' }
const PADDING: Readonly<Record<ButtonSize, string>> = { sm: 'px-2', md: 'px-space-sm', lg: 'px-space-md' }

/** The class string of a button look, for elements that must stay native (a download link). */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string): string {
  const padding = variant === 'tertiary' ? '' : variant === 'primary' && size === 'md' ? 'px-space-md' : PADDING[size]
  return [BASE, VARIANT[variant], HEIGHT[size], padding, extra].filter(Boolean).join(' ')
}

interface ButtonLook {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  /** Leading Material Symbols icon name. */
  readonly icon?: string
}

export interface ButtonProps extends ComponentProps<'button'>, ButtonLook {
  /** Spinner over the label (width kept), aria-busy, clicks ignored. */
  readonly loading?: boolean
}

export type LinkButtonProps = ComponentProps<typeof Link> & ButtonLook

const ignoreClick = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault()

function Content({ icon, loading, children }: { readonly icon?: string; readonly loading: boolean; readonly children: ReactNode }) {
  return (
    <>
      <span className={`inline-flex items-center gap-space-xs${loading ? ' invisible' : ''}`}>
        {icon !== undefined && <Icon name={icon} size={16} />}
        {children}
      </span>
      {loading && <Icon name="sync" size={16} className="absolute motion-safe:animate-spin" />}
    </>
  )
}

/** Label = verb + object ("Approve batch"), never "OK". Native <button>, type="button" unless given. */
export function Button({ variant = 'secondary', size = 'md', icon, loading = false, type = 'button', className, children, onClick, ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={buttonClass(variant, size, className)} aria-busy={loading || undefined} onClick={loading ? ignoreClick : onClick}>
      <Content icon={icon} loading={loading}>{children}</Content>
    </button>
  )
}

/** A link that looks like a button (navigation, not an action). */
export function LinkButton({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link {...rest} className={buttonClass(variant, size, className)}>
      <Content icon={icon} loading={false}>{children}</Content>
    </Link>
  )
}

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'aria-label'> {
  readonly icon: string
  /** Accessible name and tooltip. Only search, close and more may be icon-only (UI_UX §1.1). */
  readonly label: string
}

/** sc_01 icon-only button (h-7 w-7). */
export function IconButton({ icon, label, type = 'button', className, ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={`h-7 w-7 shrink-0 text-secondary hover:text-on-surface hover:bg-surface-container rounded inline-flex items-center justify-center transition-colors ${FOCUS_RING}${className === undefined ? '' : ` ${className}`}`}
    >
      <Icon name={icon} size={18} />
    </button>
  )
}
