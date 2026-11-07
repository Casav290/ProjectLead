import { looksSpam } from '../server/lib/mailbox/types.js'

/** Ce que la règle « marqué comme spam » retient et laisse passer. Sans base ni réseau : npx tsx scripts/spam-check.ts */
const SPAM = [
  '[SPAM] | HVB844005112026', '[SPAM]', '[Spam] offre', '[spam] offre', ' [SPAM] offre', '***SPAM*** offre', '*** SPAM *** offre', '*****SPAM***** offre',
  '[***SPAM***] offre', '{SPAM} offre', '(SPAM) offre', '<SPAM> offre', '[SPAM?] offre', '[SPAM 5.2] offre', '[SPAM - 7.5] offre', '[SPAM-7] offre', '[SPAM 7/10] offre',
  '[SPAM-LOW] offre', '[Spam score: 7] offre', '[Possible spam] offre', '[POSSIBLE-SPAM] offre', '[SUSPECTED SPAM] offre', '[SUSPECTED-SPAM] offre', '[Probable Spam] offre',
  '[PROBABLY SPAM] offre', '[MAYBE SPAM] offre', '[EXTERNAL] [SPAM] offre', '[SPAM] Re: offre', '[SPAM] Fwd: offre', 'SPAM: offre', 'SPAM - offre', 'SPAM | offre',
  '[Pourriel] offre', '[Indésirable] offre', '[Courrier indésirable] offre', '[Junk] offre', '[Spamverdacht] Angebot', '[Verdacht auf Spam] Angebot', '[Posta indesiderata] offerta', '[Correo no deseado] oferta',
]
const NOT_SPAM = [
  '', 'Offre', 'Spam', 'Comment éviter le spam dans vos envois', 'Spam : comment l’éviter', 'Spam: comment l’éviter', 'SPAM : comment l’éviter', 'SPAM-Filter aktualisiert', 'Re: notre problème de spam', 'Votre filtre anti-spam',
  'Re: notre problème de [spam]', '[Spam filter] rapport hebdomadaire', '[Spammer list] mise à jour', '(Spamhaus) nouvelle liste', 'Monty Python: SPAM: le sketch',
  '[EXTERNAL] Devis', 'Re: [Ticket 123] Question', 'Fwd: Offre', 'Courrier indésirable : que faire ?', 'Indésirable', '[Important notice] Tax changes in Vietnam', 'Junk removal quote',
  // Une personne qui répond à un faux positif, ou qui le transfère : ce n'est plus la marque d'un filtre.
  'Re: [SPAM] Demande de devis', 'RE: Re: [SPAM] x', 'Fwd: [SPAM] Facture 2026', 'TR: [SPAM] Commande', 'AW: ***SPAM*** Angebot', 'Re: SPAM: offre', '[EXT] Re: [SPAM] offre',
  // Un astérisque de mise en forme, une année : pas une marque.
  '*Spam filter configuration*', '** Spam filter down **', '* Spam report', '*Junk removal quote', '** Junk removal **', '*Indésirables : que faire', '[Spam 2026] Conférence', '(Spam 2026) Conférence',
]
const h = (o: Record<string, string>) => (n: string) => o[n] ?? ''
const failed: string[] = []
for (const s of SPAM) if (!looksSpam(s)) failed.push(`devrait être marqué : ${s}`)
for (const s of NOT_SPAM) if (looksSpam(s)) failed.push(`ne devrait pas l'être : ${s}`)
for (const [o, want] of [
  [{ 'X-Spam-Flag': 'YES' }, true], [{ 'X-Spam-Flag': 'yes' }, true], [{ 'X-Spam-Status': 'Yes, score=9.1' }, true], [{ 'X-Spam': 'Yes' }, true],
  [{ 'X-Spam-Flag': 'NO' }, false], [{ 'X-Spam-Status': 'No, score=0.1 required=5.0' }, false], [{ 'X-Spam': 'No' }, false], [{ 'X-Spam-Status': '' }, false], [{}, false],
] as [Record<string, string>, boolean][]) if (looksSpam('Offre', h(o)) !== want) failed.push(`en-têtes ${JSON.stringify(o)} : attendu ${want}`)
if (looksSpam(null) || looksSpam(undefined)) failed.push('objet absent')
// Un objet énorme, fait pour ralentir une expression régulière, se lit sans attendre.
const t0 = Date.now()
const pad = ' '.repeat(294)
for (const s of ['[a]'.repeat(100000), ' '.repeat(100000), 're:'.repeat(100000), '['.repeat(100000), '*'.repeat(100000), `(spam${pad}x`, `[spam${pad}x`, `{spam${pad}x`, `<spam${pad}x`,
  `*spam${pad}x`, `[spam${'\u00a0'.repeat(294)}x`, `[spam${'1'.repeat(294)}x`, `[${'*'.repeat(294)}x`, `*${'*'.repeat(294)}spam x`, `${'[a] '.repeat(74)}x`]) for (let i = 0; i < 100; i++) looksSpam(s)
if (Date.now() - t0 > 500) failed.push(`trop lent : ${Date.now() - t0} ms`)
if (failed.length) { console.error(failed.join('\n')); process.exit(1) }
console.log(`SPAM_CHECK_OK ${SPAM.length} marqués, ${NOT_SPAM.length} ordinaires`)
