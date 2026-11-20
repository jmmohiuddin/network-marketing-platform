import { isLocale, offeredLocales, primarySubtag, type Catalogues, type Locale } from '../../lib/locale.js'

// D-BM-11 portal mails (invitation, sign-in code) per supported locale; staff and vendor mails stay English. Every key of
// en exists in every locale with the same placeholders (mail-locale.test.ts, the release check).

export const PORTAL_MAIL_CATALOGUES: Catalogues = {
  en: {
    'invitation.subject': 'Your account at {tenant}',
    'invitation.invited': '{inviter} invited you to {tenant}.',
    'invitation.inviter_unknown': 'An administrator',
    'invitation.link': 'Choose your password with this link. It works once, until {expires_at}:',
    'invitation.ignore': 'If you did not expect this invitation, ignore this email.',
    'sign_in_code.subject': 'Your sign-in code for {tenant}',
    'sign_in_code.code': 'Your sign-in code is {code}.',
    'sign_in_code.validity': 'It works once, for {minutes} minutes. If you did not ask to sign in, ignore this email.',
  },
  de: {
    'invitation.subject': 'Ihr Konto bei {tenant}',
    'invitation.invited': '{inviter} hat Sie zu {tenant} eingeladen.',
    'invitation.inviter_unknown': 'Ein Administrator',
    'invitation.link': 'Wählen Sie Ihr Passwort über diesen Link. Er funktioniert einmal, bis {expires_at}:',
    'invitation.ignore': 'Wenn Sie diese Einladung nicht erwartet haben, ignorieren Sie diese E-Mail.',
    'sign_in_code.subject': 'Ihr Anmeldecode für {tenant}',
    'sign_in_code.code': 'Ihr Anmeldecode lautet {code}.',
    'sign_in_code.validity': 'Er funktioniert einmal, {minutes} Minuten lang. Wenn Sie keine Anmeldung angefordert haben, ignorieren Sie diese E-Mail.',
  },
}

/** The market default: the primary subtag of the market's first language when supported, else en (null = no market). */
export function marketDefaultLocale(languages: readonly string[] | null): Locale {
  const first = primarySubtag(languages?.[0] ?? 'en')
  return isLocale(first) ? first : 'en'
}

/** A portal user's mail locale: the saved preference when the market offers it, else the market default. */
export function userMailLocale(saved: string | null, languages: readonly string[]): Locale {
  return saved !== null && (offeredLocales(languages) as readonly string[]).includes(saved) ? (saved as Locale) : marketDefaultLocale(languages)
}
