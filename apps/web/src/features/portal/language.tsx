'use client'

import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, FOCUS_RING } from '../../components/button'
import { Icon } from '../../components/icon'
import { CARD, PAGE_TITLE, SECTION_TITLE } from './blocks'
import { errorText } from './format'
import type { Locale } from './i18n'
import { usePortal } from './shell'

// SC-38 view 3 language (D-BM-11, C-BM-16): the locales the participant's market offers as a radio list of endonyms,
// the current one selected; Save sends PUT /v1/me/locale and the server-rendered portal renders again in it. Formats
// follow the language and the currency is the market's: no currency or date-format selector. Save stays enabled on the
// shown locale: me.locale may come from Accept-Language with nothing saved, and e-mails follow only the saved choice.

export function LanguagePage() {
  const api = useApi()
  const { me, words, refresh } = usePortal()
  const { t, locale } = words
  const [chosen, setChosen] = useState<Locale>(me.locale)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  // The language's name in the portal's language under its endonym ("Deutsch" / "German"), when it differs.
  const names = new Intl.DisplayNames([locale], { type: 'language' })
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFailure(null)
    setSaved(false)
    try {
      await api.put('/v1/me/locale', { locale: chosen })
      setSaved(true)
      refresh()
    } catch (error) {
      setFailure(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <h1 className={PAGE_TITLE}>{t('language.title')}</h1>
      <form onSubmit={save} className={`${CARD} flex flex-col gap-space-sm`} data-testid="card">
        <fieldset className="flex flex-col gap-space-sm min-w-0">
          <legend className="flex flex-col gap-space-xxs mb-space-sm">
            <span className={SECTION_TITLE}>{t('language.heading')}</span>
            <span className="font-body-lg text-body-lg text-on-surface-variant">{t('language.text')}</span>
          </legend>
          <div className="flex flex-col gap-space-xs">
            {me.locales.map((option) => {
              const name = names.of(option.code)
              const checked = option.code === chosen
              return (
                <label key={option.code} lang={option.code}
                  className={`flex items-center justify-between gap-space-sm min-h-11 p-space-sm rounded-lg cursor-pointer transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${checked ? 'bg-surface-container-low hover:bg-surface-container' : 'bg-surface-container-lowest hover:bg-surface-container-low'}`}>
                  <span className="flex items-center gap-space-xs min-w-0">
                    <Icon name="translate" size={20} className={checked ? 'text-primary' : 'text-outline'} />
                    <span className="flex flex-col min-w-0">
                      <span className="font-body-lg text-body-lg font-semibold text-on-surface">{option.label}</span>
                      {name !== undefined && name !== option.label && <span lang={locale} className="font-caption text-caption text-on-surface-variant">{name}</span>}
                    </span>
                  </span>
                  <input type="radio" name="portal-locale" value={option.code} checked={checked} onChange={() => setChosen(option.code)}
                    className={`accent-primary w-5 h-5 shrink-0 ${FOCUS_RING}`} />
                </label>
              )
            })}
          </div>
        </fieldset>
        {failure !== null && <Banner tone="danger" title={t('language.not_saved')}>{errorText(failure, t)}</Banner>}
        {saved && <p role="status" className="font-body-lg text-body-lg text-on-surface">{t('language.saved')}</p>}
        <Button type="submit" variant="primary" size="lg" loading={busy} data-testid="primary-action">{t('language.save')}</Button>
      </form>
    </>
  )
}
