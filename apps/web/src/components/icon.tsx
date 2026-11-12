/** Stitch icon sizes (px). 16 tables, 18 nav and buttons, 20 header, 24 empty states. */
export type IconSize = 13 | 14 | 15 | 16 | 18 | 20 | 24

// Full class strings: Tailwind only generates classes it finds literally in the source.
const SIZE_CLASS: Readonly<Record<IconSize, string>> = {
  13: 'text-[13px]', 14: 'text-[14px]', 15: 'text-[15px]', 16: 'text-[16px]', 18: 'text-[18px]', 20: 'text-[20px]', 24: 'text-[24px]',
}

export interface IconProps {
  /** Material Symbols ligature name, for example "lock". */
  readonly name: string
  readonly size?: IconSize
  readonly filled?: boolean
  readonly className?: string
}

/** Material Symbols Outlined glyph (self-hosted). Decorative: the control or text beside it carries the name. */
export function Icon({ name, size = 18, filled = false, className }: IconProps) {
  const classes = ['material-symbols-outlined select-none', SIZE_CLASS[size], filled ? "[font-variation-settings:'FILL'_1]" : '', className ?? '']
  return <span aria-hidden="true" className={classes.filter(Boolean).join(' ')}>{name}</span>
}
