/**
 * Contrôle des cinq langues (chantier du 27.10.2026). `npx tsx scripts/i18n-check.ts <mode>` :
 *
 *   --keys       les fichiers de langue (src/i18n/locales/<langue>/*.json et server/i18n/<langue>.ts) ont tous les mêmes
 *                clés, aucune valeur vide, les mêmes variables {x} ; une valeur d'une autre langue identique au français
 *                n'est admise que si elle n'a rien de français ; toute clé écrite en dur dans le code (t('…'),
 *                labels('…', [...]), tr(locale, '…')) existe. → I18N_KEYS_OK
 *   --hardcoded  aucun texte resté en dur : texte JSX, attributs lus (placeholder, title, aria-label, alt, label…) et
 *                chaînes « françaises » dans src/ et dans les textes que le serveur envoie. → I18N_HARDCODED_OK
 *   --control    le même détecteur, sur un fichier témoin plein de textes en dur, doit tous les trouver. → I18N_CONTROL_OK
 *
 * Une ligne qui doit garder un texte (nom propre, exemple d'adresse) porte le commentaire `i18n-ok`.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import ts from 'typescript'

const ROOT = join(import.meta.dirname, '..')
const LANGS = ['fr', 'de', 'en', 'it', 'es'] as const
const mode = process.argv[2]

const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|mts)$/.test(f)) out.push(p)
  }
  return out
}

// ------------------------------------------------------------------ ce qui « a l'air français »
const ACCENTS = /[àâçéèêëîïôûùœÀÂÇÉÈÊÎÔÛŒ]/
const FR_WORDS = /(^|[\s'’(«])(le|la|les|des|du|une|et|ou|pour|avec|sans|vous|votre|vos|nous|est|sont|pas|aucun|aucune|cette|ces|dans|sur|aux|au|qui|que|ne|plus|déjà|encore|tout|tous|toutes)(?=[\s,.:;!?»)]|$)/i
export const looksFrench = (s: string) => {
  const x = s.replace(/\$\{[^}]*\}/g, ' ').trim()
  if (!/\p{L}{2,}/u.test(x)) return false
  if (ACCENTS.test(x)) return true
  // Au moins deux mots dont un mot outil français : « Voir les formules », « Pas de projet ».
  return /\p{L}+\s+\p{L}+/u.test(x) && FR_WORDS.test(x)
}

const READ_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'hint', 'subtitle', 'confirmLabel', 'aria-description', 'emptyLabel'])
// Les noms propres seuls, identiques dans toutes les langues.
const BRANDS = /^(ProjectLead|PL|CRMlead|InvoiceLead|ERPlead|ScanLead|Greetlead|Gmail|Microsoft 365|Outlook|IMAP|SMTP|API|iCal|CSV|Stripe|Z\.ai|GLM|[A-Z]{2,4})$/
const LABEL_PROPS = new Set(['label', 'title', 'text', 'message', 'hint', 'help', 'description', 'desc', 'placeholder', 'subject', 'heading', 'empty', 'cta', 'name', 'short', 'long', 'body', 'intro', 'action', 'tip'])
const SKIP_CALLS = new Set(['t', 'tr', 'labels', 'require', 'import', 'useLoad', 'querySelector', 'querySelectorAll', 'getItem', 'setItem', 'addEventListener', 'removeEventListener'])

type Hit = { file: string; line: number; text: string }

function scanFile(file: string, opts: { server: boolean }): Hit[] {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const hits: Hit[] = []
  const add = (node: ts.Node, text: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
    if (/i18n-ok/.test(lines[line] ?? '') || /i18n-ok/.test(lines[line - 1] ?? '')) return
    hits.push({ file: relative(ROOT, file), line: line + 1, text: text.replace(/\s+/g, ' ').trim().slice(0, 90) })
  }
  const calleeName = (n: ts.CallExpression) => {
    const e = n.expression
    if (ts.isIdentifier(e)) return e.text
    if (ts.isPropertyAccessExpression(e)) return (ts.isIdentifier(e.expression) ? e.expression.text + '.' : '') + e.name.text
    return ''
  }
  const skipped = (node: ts.Node): boolean => {
    for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p)) return true
      if (ts.isCallExpression(p)) {
        const name = calleeName(p)
        if (SKIP_CALLS.has(name) || name.split('.').pop() === 't' || /^console\./.test(name)) return true
        if (opts.server && /^(db\.query|client\.query|pool\.query)$/.test(name) && !looksUserSql(node)) return true
      }
      if (ts.isJsxAttribute(p)) {
        const n = p.name.getText(sf)
        if (n === 'className' || n === 'key' || n === 'to' || n === 'href' || n === 'id' || n === 'htmlFor' || n === 'type' || n === 'name' || n === 'autoComplete' || n === 'inputMode' || n === 'pattern' || n === 'd' || n === 'viewBox' || n === 'fill' || n === 'stroke' || n === 'role' || n.startsWith('data-')) return true
      }
      if (ts.isPropertyAssignment(p) && p.name === node) return true
      if (ts.isBinaryExpression(p) && /===|!==|==|!=/.test(p.operatorToken.getText(sf))) return true
      if (ts.isCaseClause(p) && p.expression === node) return true
      if (ts.isNewExpression(p) && /Error$/.test(p.expression.getText(sf)) && !opts.server) return true
    }
    return false
  }
  // Une requête SQL qui écrit un texte lisible (notification) : ses chaînes françaises comptent.
  const looksUserSql = (node: ts.Node) => looksFrench(node.getText(sf).replace(/--[^\n]*/g, ''))
  // Un mot qui commence par une majuscule (« Projets », « Temps ») : texte d'écran s'il est rendu dans le JSX ou rangé
  // sous une propriété de libellé (`{ label: 'Projets' }`).
  const wordy = (x: string) => /^[A-ZÀ-Ý][a-zà-ÿ]{2,}/.test(x.trim()) && !/^[A-Z][a-z]+[A-Z]/.test(x.trim())
  const shown = (node: ts.Node): boolean => {
    const p = node.parent
    if (p && ts.isPropertyAssignment(p) && p.initializer === node && LABEL_PROPS.has(p.name.getText(sf))) return true
    for (let q: ts.Node | undefined = p; q; q = q.parent) {
      if (ts.isJsxExpression(q)) return true
      if (ts.isCallExpression(q) || ts.isFunctionLike(q) || ts.isBlock(q) || ts.isJsxAttribute(q)) return false
    }
    return false
  }
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const s = node.getText(sf)
      if (/\p{L}{2,}/u.test(s) && !BRANDS.test(s.trim())) add(node, s)
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const n = node.name.getText(sf)
      if (READ_ATTRS.has(n) && /\p{L}{2,}/u.test(node.initializer.text)) add(node, `${n}="${node.initializer.text}"`)
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!(node.parent && ts.isJsxAttribute(node.parent)) && (looksFrench(node.text) || (!opts.server && wordy(node.text) && shown(node))) && !skipped(node)) add(node, node.text)
    } else if (ts.isTemplateExpression(node)) {
      const raw = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ${} ')
      if (looksFrench(raw) && !skipped(node)) add(node, raw)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

// Les fichiers dont le texte arrive à l'écran ou chez le client.
const CLIENT_SKIP = [/^src\/i18n\//, /^src\/lib\/leadFamily\.ts$/]
// Serveur : ce qui part en e-mail, notification, document. Pas : les consignes au modèle (assistant/prompt, tools :
// lues par l'IA, qui répond dans la langue de l'interface), la démonstration locale (seed), le code repris de CRMlead.
const SERVER_SKIP = [/^server\/i18n\//, /^server\/lib\/mailbox\//, /^server\/lib\/assistant\//, /^server\/seed\.ts$/, /^server\/migrate\.ts$/]

function hardcoded(files?: string[]): Hit[] {
  const all: Hit[] = []
  const client = files ?? walk(join(ROOT, 'src')).filter((f) => !CLIENT_SKIP.some((r) => r.test(relative(ROOT, f))))
  for (const f of client) all.push(...scanFile(f, { server: false }))
  if (!files) {
    for (const f of walk(join(ROOT, 'server')).filter((f) => !SERVER_SKIP.some((r) => r.test(relative(ROOT, f)))))
      all.push(...scanFile(f, { server: true }))
  }
  return all
}

// ------------------------------------------------------------------ clés
function loadClient(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const l of LANGS) {
    out[l] = {}
    const dir = join(ROOT, 'src/i18n/locales', l)
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      for (const [k, v] of Object.entries(d)) {
        if (k in out[l]) throw new Error(`clé en double ${l}/${f}: ${k}`)
        out[l][k] = v as string
      }
    }
  }
  return out
}
async function loadServer(): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {}
  for (const l of LANGS) out[l] = (await import(join(ROOT, 'server/i18n', `${l}.ts`))).default
  return out
}

// Noms propres, sigles, mots identiques d'une langue à l'autre.
const SAME_OK = /^(ProjectLead|CRMlead|InvoiceLead|ERPlead|ScanLead|Greetlead|Compte Lead|Pro|Pro\+|Gratuit|API|IMAP|SMTP|iCal|Gmail|Microsoft 365|Google|Outlook|Email|E-mail|Emails|Agenda|Code|Notifications|Gantt|Kanban|Total|Budget|Client|Clients|Description|Normal|Normale|Urgent|Urgente|Contact|Contacts|Message|Note|Notes|Documents|Format|Global|Minimum|Maximum|Information|Pause|Total HT|TVA|CSV|Stripe|OK|Ok)$/i

function checkDicts(name: string, d: Record<string, Record<string, string>>, errors: string[]) {
  const frKeys = Object.keys(d.fr).sort()
  const vars = (s: string) => [...s.matchAll(/\{(\w+)(?:\||\})/g)].map((m) => m[1]).sort().join(',')
  for (const l of LANGS) {
    const keys = new Set(Object.keys(d[l]))
    for (const k of frKeys) if (!keys.has(k)) errors.push(`${name} ${l}: clé absente ${k}`)
    for (const k of keys) if (!(k in d.fr)) errors.push(`${name} ${l}: clé en trop ${k}`)
    for (const [k, v] of Object.entries(d[l])) {
      if (typeof v !== 'string' || !v.trim()) errors.push(`${name} ${l}: valeur vide ${k}`)
      else if (k in d.fr && vars(v) !== vars(d.fr[k])) errors.push(`${name} ${l}: variables différentes ${k} (${vars(v)} ≠ ${vars(d.fr[k])})`)
      else if (l !== 'fr' && v === d.fr[k] && looksFrench(v) && !SAME_OK.test(v.trim())) errors.push(`${name} ${l}: resté en français ${k} = « ${v.slice(0, 60)} »`)
    }
  }
}

function usedKeys(dir: string, re: RegExp[]): Map<string, string> {
  const used = new Map<string, string>()
  for (const f of walk(join(ROOT, dir))) {
    const s = readFileSync(f, 'utf8')
    for (const r of re) for (const m of s.matchAll(r)) used.set(m[1], relative(ROOT, f))
    for (const m of s.matchAll(/labels\(\s*'([\w.]+)'\s*,\s*\[([^\]]*)\]/g))
      for (const k of m[2].matchAll(/'(\w+)'/g)) used.set(`${m[1]}.${k[1]}`, relative(ROOT, f))
  }
  return used
}

if (mode === '--keys') {
  const errors: string[] = []
  const client = loadClient()
  checkDicts('src', client, errors)
  const server = await loadServer()
  checkDicts('server', server, errors)
  for (const [k, f] of usedKeys('src', [/\bt\(\s*'([\w.-]+)'/g, /\bt\(\s*"([\w.-]+)"/g]))
    if (!(k in client.fr)) errors.push(`src: clé utilisée absente ${k} (${f})`)
  for (const [k, f] of usedKeys('server', [/\btr\(\s*[\w.?]+\s*,\s*'([\w.-]+)'/g]))
    if (!(k in server.fr)) errors.push(`server: clé utilisée absente ${k} (${f})`)
  for (const e of errors.slice(0, 200)) console.log('  ✗', e)
  console.log(`${Object.keys(client.fr).length} clés client, ${Object.keys(server.fr).length} clés serveur, 5 langues, ${errors.length} erreur(s)`)
  if (errors.length) process.exit(1)
  console.log('I18N_KEYS_OK')
} else if (mode === '--hardcoded') {
  const only = process.argv.slice(3).map((f) => join(ROOT, f))
  const hits = hardcoded(only.length ? only : undefined)
  const per = new Map<string, number>()
  for (const h of hits) per.set(h.file, (per.get(h.file) ?? 0) + 1)
  for (const h of hits.slice(0, process.env.ALL ? 100000 : 300)) console.log(`  ${h.file}:${h.line}  ${h.text}`)
  if (hits.length) {
    console.log('\nPar fichier :'); for (const [f, n] of [...per].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${f}`)
    console.log(`${hits.length} texte(s) en dur`); process.exit(1)
  }
  console.log('I18N_HARDCODED_OK')
} else if (mode === '--control') {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-control-'))
  const f = join(dir, 'Temoin.tsx')
  writeFileSync(f, `export function Temoin() {
  const msg = 'Aucun projet en cours'
  const tpl = \`Voici où en est \${msg}\`
  const nav = [{ label: 'Projets' }]
  return <div title="Ouvrir le projet">{ok ? 'Projets' : 'Temps'}<p>Bonjour tout le monde</p><input placeholder="Rechercher un client" aria-label="Recherche" />{msg}{tpl}<span className="text-sm">{t('common.save')}</span></div>
}
`)
  const hits = hardcoded([f])
  const want = ['Projets', 'Projets', 'Temps', 'Aucun projet en cours', 'Voici où en est', 'title="Ouvrir le projet"', 'Bonjour tout le monde', 'placeholder="Rechercher un client"', 'aria-label="Recherche"']
  const missing = want.filter((w) => !hits.some((h) => h.text.includes(w)))
  const extra = hits.filter((h) => /text-sm|common\.save/.test(h.text))
  console.log(`témoin : ${hits.length} trouvés, ${missing.length} manqués, ${extra.length} faux positifs`)
  if (missing.length || extra.length || hits.length !== want.length || hits.filter((h) => h.text === 'Projets').length !== 2) { console.log(missing, extra); process.exit(1) }
  console.log('I18N_CONTROL_OK')
} else {
  console.log('usage : --keys | --hardcoded [fichiers…] | --control'); process.exit(2)
}
