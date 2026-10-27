import clsx from 'clsx'
import { LOCALES, LOCALE_NAMES, isLocale, useI18n } from '../i18n'

/**
 * Le sélecteur de langue, sur chaque page (connectée et publique, ordinateur et téléphone). La page change de langue
 * sur place : ni rechargement, ni saisie perdue. Le choix est gardé (localStorage, cookie et profil).
 * `data-lang-select` : le contrôle des pages (scripts/e2e-langues.mjs) le cherche.
 */
export default function LanguageSelect({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()
  return (
    <label className={clsx('relative inline-flex items-center', className)} data-lang-select="">
      <span className="sr-only">{t('langSelect.label')}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="pointer-events-none absolute left-2 h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
      </svg>
      <select value={locale} aria-label={t('langSelect.label')} title={t('langSelect.label')}
              onChange={(e) => { if (isLocale(e.target.value)) setLocale(e.target.value) }}
              className={clsx('h-9 cursor-pointer appearance-none border border-input bg-card pl-7 pr-2 text-sm font-semibold hover:bg-muted focus:border-accent focus:outline-none')}>
        {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
      </select>
    </label>
  )
}
