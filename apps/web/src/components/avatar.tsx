/** "Ada Lovelace" -> "AL"; no name -> first letter of the email. */
export function initials(name: string | null, email: string): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  const letters = words.length === 0 ? email.charAt(0) : `${words[0]!.charAt(0)}${words.length > 1 ? words.at(-1)!.charAt(0) : ''}`
  return letters.toUpperCase()
}

/** sc_01 avatar box with initials (no images: guidelines §4). Hidden from assistive technology: the name is shown beside it. */
export function Avatar({ name, email }: { readonly name: string | null; readonly email: string }) {
  return (
    <span aria-hidden="true" className="w-8 h-8 shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center font-caption text-caption font-semibold">
      {initials(name, email)}
    </span>
  )
}
