import type { ReactNode } from 'react'

/**
 * sc_27 card layout (sign-in, MFA, invitation, role-home redirect, 404): the centred 480 px auth card on the
 * surface background (`wide`: the 640 px sc_41 form card). The Stitch header (wordmark, certification claims) and gradient rule are not rendered:
 * no brand is decided and claims need a data source (guidelines §4, §6.3).
 */
export function CardLayout({ children, footer, wide = false }: { readonly children: ReactNode; readonly footer?: ReactNode; readonly wide?: boolean }) {
  return (
    <div className="bg-surface font-body-md text-on-surface antialiased min-h-screen flex flex-col justify-between">
      <main className="w-full flex-1 flex flex-col items-center justify-center px-margin-mobile sm:px-gutter py-space-xl">
        <div className={`w-full ${wide ? 'max-w-[640px]' : 'max-w-[480px]'} flex flex-col gap-space-md`}>
          <div data-testid="card" className="w-full bg-surface-container-lowest rounded-xl shadow-md p-space-lg flex flex-col gap-space-lg">{children}</div>
          {footer !== undefined && <div className="p-space-md bg-surface-container-low rounded-lg font-caption text-caption text-on-surface-variant">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
