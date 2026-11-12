import qrcode from 'qrcode-generator'

// The standard 4-module light margin scanners need around the code.
const QUIET_ZONE = 4

/** SVG path of the dark modules and the side length in modules (quiet zone included). */
export function qrPath(value: string): { readonly d: string; readonly modules: number } {
  const qr = qrcode(0, 'M')
  qr.addData(value)
  qr.make()
  const count = qr.getModuleCount()
  const squares: string[] = []
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) squares.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`)
    }
  }
  return { d: squares.join(''), modules: count + QUIET_ZONE * 2 }
}

export interface QrCodeProps {
  /** Encoded text, for example the otpauth:// URI. */
  readonly value: string
  /** Says what the code is for and where the text alternative is. */
  readonly label: string
  readonly size?: number
}

/** QR code as inline SVG; dark on light in both themes, because scanners need it. */
export function QrCode({ value, label, size = 192 }: QrCodeProps) {
  const { d, modules } = qrPath(value)
  return (
    <svg className="qr" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${modules} ${modules}`} shapeRendering="crispEdges">
      <rect className="qr-background" width={modules} height={modules} />
      <path className="qr-modules" d={d} />
    </svg>
  )
}
