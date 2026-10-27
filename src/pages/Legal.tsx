import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import LanguageSelect from '../components/LanguageSelect'
import { intlLocale, useT } from '../i18n'

/**
 * Politique de confidentialité et conditions d'utilisation, lisibles sans compte.
 *
 * Le texte dit ce que le code fait réellement (boîtes mail : server/lib/mailbox/index.ts, pages
 * publiques : server/routes/portal.ts…) ; le modifier, c'est modifier une promesse.
 */

// La date de dernière mise à jour, écrite au rendu dans la langue de la page.
const UPDATED = '2026-10-13'
// Le contact de Quantum Liquid LLC, commun aux applications Lead.
const CONTACT = 'support@scanlead.io'

/**
 * Le plan des deux textes : pour chaque section, ses blocs dans l'ordre — 0 = un paragraphe, n > 0 = une liste de n
 * points. Les textes sont dans locales/<langue>/legal.json : titre `legal.<doc>.s<i>.h`, paragraphe `legal.<doc>.s<i>.<b>`,
 * point de liste `legal.<doc>.s<i>.<b>.<n>` (b et n comptés depuis 1). Variables : {publisher}, {contact}, {updated}.
 */
type Doc = 'privacy' | 'terms'
const PLAN: Record<Doc, number[][]> = {
  privacy: [[6], [0, 0, 0, 0], [0, 4, 0], [0], [0, 6, 0], [0], [0], [0], [0]],
  terms: [[0], [0, 0, 0, 0], [0], [0], [3], [0], [0, 0, 0]],
}

export default function Legal({ kind }: { kind: Doc }) {
  const t = useT()
  const vars = {
    publisher: t('legal.publisher'),
    contact: CONTACT,
    updated: new Date(`${UPDATED}T12:00:00Z`).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long', year: 'numeric' }),
  }
  const title = t(`legal.${kind}.title`)
  useEffect(() => {
    const before = document.title
    document.title = `${title} · ProjectLead`
    return () => { document.title = before }
  }, [title])
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <article className="mx-auto max-w-[720px] border border-input bg-card p-6 sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-extrabold">
            <span aria-hidden="true" className="grid h-7 w-7 place-items-center bg-brand text-[11px] text-white">PL</span>ProjectLead
          </Link>
          <LanguageSelect />
        </div>
        <h1 className="mt-6 text-[28px] font-extrabold leading-tight tracking-[-.025em]">{title}</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t(`legal.${kind}.intro`, vars)}</p>
        {PLAN[kind].map((blocks, i) => {
          const sec = `legal.${kind}.s${i + 1}`
          return (
            <section key={sec} className="mt-8">
              <h2 className="text-base font-extrabold">{t(`${sec}.h`)}</h2>
              {blocks.map((n, b) => n
                ? <ul key={b} className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                    {Array.from({ length: n }, (_, k) => <li key={k}>{t(`${sec}.${b + 1}.${k + 1}`, vars)}</li>)}</ul>
                : <p key={b} className="mt-2 text-sm leading-relaxed">{t(`${sec}.${b + 1}`, vars)}</p>)}
            </section>
          )
        })}
        <p className="mt-10 text-[13px] text-muted-foreground">
          <Link to={kind === 'privacy' ? '/conditions' : '/confidentialite'} className="hover:underline">
            {kind === 'privacy' ? t('shell.legal.terms') : t('legal.privacy.title')}</Link>
        </p>
      </article>
    </div>
  )
}
