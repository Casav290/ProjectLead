import Anthropic from '@anthropic-ai/sdk'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import { SESSION_COOKIE } from '../auth.js'
import { withTenant, type Db } from '../db.js'
import { body, HttpError, router } from '../lib/http.js'
import { localDay } from '../lib/time.js'
import { publicUrl } from '../lib/env.js'
import { asLocale, isLocale, tr } from '../lib/i18n.js'
import { dynamicSystem, STABLE_SYSTEM } from '../lib/assistant/prompt.js'
import { allowanceFor, completeUsage, logConfirm, reserveMessage } from '../lib/assistant/quota.js'
import { doneLine, OpFailure, routeOutcome, runOps } from '../lib/assistant/run.js'
import { labelOf, scrubPaths } from '../lib/assistant/pages.js'
import { buildTools, pageAllowed, type AssistantAction } from '../lib/assistant/tools.js'
import { MAX_TOKEN_CHARS, opAllowed, opLabel, verifyConfirm } from '../lib/assistant/token.js'

/**
 * Assistant IA (bulle en bas à droite, cahier commun des applications Lead du 24.10.2026).
 *
 * POST /api/assistant          { messages, page, locale } → { messages, reply, actions, allowance }
 * POST /api/assistant/confirm  { token }                  → exécute l'écriture proposée, une seule fois
 * GET  /api/assistant/allowance                           → { allowance } : la formule gratuite et ce qu'il en reste
 *
 * Session obligatoire (garde de server/index.ts : 401 sinon). Clé ANTHROPIC_API_KEY absente : 503, et la bulle est
 * masquée (`features.assistant` de /api/me). Rien de la conversation n'est gardé en base : le navigateur renvoie
 * l'historique à chaque tour ; seuls jetons, outils et erreurs sont journalisés (`assistant_usage`).
 */
const app = router()

export const MODEL = 'claude-opus-5-5'
// Un plan de projet complet (étapes, tâches, jalons, dépendances) tient dans UN appel d'outil : 16 000 jetons de sortie
// au plus (cahier du 27.10.2026, A6). Le tour reste sous la durée de la fonction Vercel (300 s, formule Hobby + Fluid).
export const MAX_TOKENS = 16_000
export const MAX_ITERATIONS = 10
/**
 * Délai global du tour (alignement des bulles, 28.10.2026, B1) : UN signal pour tout le tour (tous les appels au modèle
 * et les outils), la durée de la fonction Vercel (maxDuration 300 s, scripts/vercel-build.mjs) moins 10 s pour répondre
 * et journaliser. Le client du modèle : 1 nouvel essai au plus, délai d'un appel = celui du tour.
 */
export const MAX_DURATION_MS = 300_000
export const TURN_TIMEOUT_MS = 290_000
/** Les contrôles le raccourcissent (faux service lent) ; jamais au-delà de TURN_TIMEOUT_MS. */
export const turnTimeoutMs = () => Math.min(TURN_TIMEOUT_MS, Number(process.env.ASSISTANT_TURN_TIMEOUT_MS) || TURN_TIMEOUT_MS)

export const assistantConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY)

const MAX_MESSAGES = 120
const MAX_HISTORY_BYTES = 400_000

const textBlock = z.object({ type: z.literal('text'), text: z.string().min(1).max(8000) }).passthrough()
const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.union([z.string().min(1).max(8000), z.array(z.record(z.string(), z.unknown())).min(1).max(200)]),
  })).min(1).max(MAX_MESSAGES),
  page: z.string().max(300).default('/'),
  locale: z.string().max(10).default('fr'),
})

const sessionCookie = (c: any) => `${SESSION_COOKIE}=${getCookie(c, SESSION_COOKIE) ?? ''}`

/**
 * Même origine (B13) : une page d'un autre site ne parle pas à l'assistant et ne confirme aucune carte. Le navigateur dit
 * d'où vient la requête (`Origin`, `Sec-Fetch-Site`) ; on compare des HÔTES (derrière Vercel, l'adresse vue par la
 * fonction n'a pas le bon schéma). Sans ces en-têtes (scripts, appels internes), rien à comparer.
 */
export function sameOrigin(c: any): boolean {
  const site = c.req.header('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = c.req.header('origin')
  if (!origin) return true
  let from: string
  try { from = new URL(origin).host } catch { return false }
  const here = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? new URL(c.req.url).host
  if (from === here) return true
  try { return Boolean(process.env.PUBLIC_URL) && new URL(process.env.PUBLIC_URL!).host === from } catch { return false }
}
app.use('*', async (c, next) => {
  if (c.req.method === 'POST' && !sameOrigin(c)) {
    throw new HttpError(403, 'origin', { message: tr(asLocale(c.get('locale')), 'assistant.error.origin') })
  }
  await next()
})

/**
 * Ce qui a fait échouer le tour (B1, B3), par `instanceof` et par le signal du délai, jamais par le nom des classes (la
 * minification le change) :
 * - timeout : le délai du tour est passé (signal abandonné) ou un appel a dépassé le délai du client ;
 * - history : le service refuse le fil (400) : seule une nouvelle conversation le débloque ;
 * - busy : service saturé (429, 529) ;
 * - upstream : toute autre panne.
 */
export function failureOf(e: unknown, deadline: AbortSignal): { kind: 'timeout' | 'history' | 'busy' | 'upstream'; code: string } {
  if (deadline.aborted || e instanceof Anthropic.APIConnectionTimeoutError) return { kind: 'timeout', code: 'timeout' }
  if (e instanceof Anthropic.BadRequestError) return { kind: 'history', code: 'api_400' }
  if (e instanceof Anthropic.RateLimitError) return { kind: 'busy', code: 'rate_limited' }
  if (e instanceof Anthropic.APIError && e.status === 529) return { kind: 'busy', code: 'api_529' }
  if (e instanceof Anthropic.APIError) return { kind: 'upstream', code: `api_${e.status ?? 'error'}` }
  return { kind: 'upstream', code: String((e as Error)?.message ?? 'error').slice(0, 80) }
}
const FAILURE: Record<ReturnType<typeof failureOf>['kind'], [number, string]> = {
  timeout: [504, 'assistant_timeout'], history: [400, 'assistant_history'], busy: [503, 'assistant_busy'], upstream: [502, 'assistant_unavailable'],
}

/**
 * Le raisonnement du modèle n'est jamais montré ni renvoyé (Suites du 29.10.2026 : « <reasoning>Respond in French,
 * tu.</reasoning> » affiché tel quel dans le fil d'une autre bulle Lead). Un bloc <reasoning>…</reasoning>,
 * <thinking>…</thinking> ou <analysis>…</analysis> est retiré ; une balise ouvrante orpheline l'est jusqu'à la fin de sa
 * ligne, une balise fermante orpheline seule. Un texte sans ces balises est rendu tel quel (mêmes octets).
 */
const REASONING = 'reasoning|thinking|analysis'
const REASONING_BLOCK = new RegExp(`<(${REASONING})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi')
const REASONING_OPEN = new RegExp(`<(?:${REASONING})\\b[^>]*>[^\\n]*`, 'gi')
const REASONING_CLOSE = new RegExp(`<\\/(?:${REASONING})\\s*>`, 'gi')
export function stripReasoning(text: string): string {
  const out = text.replace(REASONING_BLOCK, '').replace(REASONING_OPEN, '').replace(REASONING_CLOSE, '')
  return out === text ? text : out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * L'historique renvoyé au navigateur (et donc au modèle au tour suivant), sans raisonnement dans les textes du modèle.
 * Les messages de la personne ne sont jamais touchés (ce qu'elle a tapé reste tel quel). Un message du modèle qui n'aurait
 * plus que des blocs de réflexion garde un texte « … » (un message vide serait refusé au tour suivant).
 */
export function withoutReasoning<M extends { role: string; content?: unknown }>(messages: M[]): M[] {
  return messages.map((m): M => {
    if (m.role !== 'assistant') return m
    if (typeof m.content === 'string') {
      const t = stripReasoning(m.content)
      return t === m.content ? m : { ...m, content: t || '…' }
    }
    if (!Array.isArray(m.content)) return m
    let changed = false
    const content: any[] = []
    for (const b of m.content as any[]) {
      if (b?.type === 'text' && typeof b.text === 'string') {
        const t = stripReasoning(b.text)
        if (t !== b.text) { changed = true; if (t) content.push({ ...b, text: t }); continue }
      }
      content.push(b)
    }
    if (!changed) return m
    if (!content.some((b) => b?.type !== 'thinking' && b?.type !== 'redacted_thinking')) content.push({ type: 'text', text: '…' })
    return { ...m, content }
  })
}

/** Les textes de TOUS les messages du modèle pendant le tour, dans l'ordre, sans doublon (B4), sans raisonnement. */
export function turnText(messages: { content: unknown[] }[]): string {
  const texts: string[] = []
  for (const m of messages) for (const b of m.content as any[]) {
    const x = b?.type === 'text' && typeof b.text === 'string' ? stripReasoning(b.text).trim() : ''
    if (x && !texts.includes(x)) texts.push(x)
  }
  return texts.join('\n\n')
}

/** Les blocs « fallback » sont de simples marqueurs (modèle de repli) : on ne les renvoie pas au tour suivant. */
const clean = (messages: Anthropic.Beta.BetaMessageParam[]) => messages.map((m) => (Array.isArray(m.content)
  ? { ...m, content: (m.content as any[]).filter((b) => b?.type !== 'fallback') }
  : m))

app.post('/', async (c) => {
  // Le délai du tour court dès l'arrivée de la demande (B1).
  const deadline = AbortSignal.timeout(turnTimeoutMs())
  if (!assistantConfigured()) throw new HttpError(503, 'assistant_not_configured')
  if (!process.env.APP_SECRET) throw new HttpError(503, 'app_secret_missing')
  // Un fil que le serveur ne peut pas reprendre (trop long, abîmé dans l'onglet) : « Nouvelle conversation » (B3).
  const b = await body(c, chatSchema).catch((e) => {
    if (e instanceof HttpError && e.code === 'invalid_input' && Object.keys((e.extra.fields ?? {}) as object).some((k) => k.startsWith('messages'))) {
      throw new HttpError(400, 'assistant_history')
    }
    throw e
  })
  if (JSON.stringify(b.messages).length > MAX_HISTORY_BYTES) throw new HttpError(413, 'assistant_history')
  // Le tour demandé : un message de la personne, en texte (les notes de l'écran, « confirmé » / « annulé », sont du texte).
  const last = b.messages[b.messages.length - 1]
  const lastOk = last.role === 'user' && (typeof last.content === 'string'
    || (last.content as unknown[]).every((x) => textBlock.safeParse(x).success))
  if (!lastOk) throw new HttpError(400, 'invalid_input', { fields: { messages: 'le dernier message doit être un texte de la personne' } }) // i18n-ok

  const ctx = c.get('ctx')
  const reservation = await reserveMessage(ctx)
  if (!reservation.ok && reservation.scope === 'free_limit') {
    // Formule gratuite, budget du mois atteint (29.10.2026, L4) : refusé AVANT tout appel au modèle, rien de réservé.
    // 402 comme les autres limites de la formule (lien vers la page Formule) ; la bulle dit quand il revient.
    const a = reservation.allowance
    throw new HttpError(402, 'free_limit', { limit: a.limited ? a.budget : null, plan: 'free',
      upgrade_url: `${publicUrl()}${reservation.upgradeUrl}`, resets_on: a.limited ? a.resets_on : null, allowance: a })
  }
  if (!reservation.ok) throw new HttpError(429, 'assistant_quota', { scope: reservation.scope })

  const account = await withTenant(ctx, async (db) => (await db.query('select name, timezone, locale from accounts where id = app_account()')).rows[0])
  const tz = account?.timezone || 'Europe/Zurich'
  const day = localDay(new Date(), tz)
  // Consignes au modèle (en français, il répond dans la langue de l'interface) ; les textes renvoyés à la personne : `l`.
  const l = isLocale(b.locale) ? b.locale : asLocale(c.get('locale'))
  const weekday = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][day.isoDay - 1]
  const roleFr = { admin: 'administrateur', manager: 'responsable', member: 'membre' }[ctx.role] ?? ctx.role

  const actions: AssistantAction[] = []
  const used: string[] = []
  const tools = buildTools({ cookie: sessionCookie(c), ctx, actions, used, today: day.date, locale: l, timezone: tz })
  const history: Anthropic.Beta.BetaMessageParam[] = clean(b.messages as Anthropic.Beta.BetaMessageParam[])
  const started = Date.now()
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }

  try {
    const client = new Anthropic({ maxRetries: 1, timeout: turnTimeoutMs() })
    const runner = client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'low' },
      // Réflexion adaptative DITE (c'est déjà le cas par défaut de ce modèle) : un modèle de repli (`fallbacks`) reçoit la
      // même requête et réfléchit lui aussi, au lieu d'écrire son raisonnement dans le texte (Suites du 29.10.2026).
      thinking: { type: 'adaptive' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        { type: 'text', text: STABLE_SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: dynamicSystem({ today: day.date, weekday, timezone: tz, locale: b.locale || account?.locale || 'fr',
          userName: c.get('name'), role: roleFr, accountName: account?.name ?? '', page: b.page }) },
      ],
      tools,
      messages: history,
      max_iterations: MAX_ITERATIONS,
      thread: false,
      // Cache de l'historique (B2) : mise en cache automatique du dernier bloc, en plus du bloc stable du système.
      // Deux marqueurs en tout (la limite est quatre).
      cache_control: { type: 'ephemeral' },
    }, { signal: deadline })   // la fonction Vercel a 300 s ; 10 tours au plus
    const turn: Anthropic.Beta.BetaMessageParam[] = []
    const seen: Anthropic.Beta.BetaMessage[] = []
    let final: Anthropic.Beta.BetaMessage | null = null
    for await (const message of runner) {
      final = message
      usage.input_tokens += message.usage.input_tokens ?? 0
      usage.output_tokens += message.usage.output_tokens ?? 0
      usage.cache_read_tokens += message.usage.cache_read_input_tokens ?? 0
      usage.cache_write_tokens += message.usage.cache_creation_input_tokens ?? 0
      // La raison d'arrêt d'abord, le texte ensuite (B4).
      if (message.stop_reason === 'refusal') break
      if (message.stop_reason === 'max_tokens' || message.stop_reason === 'pause_turn') {
        // Réponse coupée : un appel d'outil inachevé ne doit pas rester dans l'historique (le tour suivant serait refusé).
        const kept = message.content.filter((blk) => blk.type === 'text')
        seen.push({ ...message, content: kept })
        turn.push({ role: 'assistant', content: kept.length ? kept : [{ type: 'text', text: '…' }] })
        break
      }
      seen.push(message)
      turn.push({ role: 'assistant', content: message.content })
      if (message.stop_reason === 'tool_use') {
        // Les résultats des outils de ce tour (calculés une seule fois : le runner reprend la même réponse).
        const results = await runner.generateToolResponse()
        if (results) turn.push(results)
      }
    }

    let reply: string
    let messages: Anthropic.Beta.BetaMessageParam[]
    if (!final) throw new Error('no_message')
    if (final.stop_reason === 'refusal') {
      // Refus (B4) : une phrase polie tout de suite ; le tour entier (la demande et ses étapes) sort de l'historique
      // renvoyé, la conversation continue depuis le tour précédent ; aucune carte ni page ouverte.
      reply = tr(l, 'assistant.refusal')
      messages = withoutReasoning(history.slice(0, -1))
      actions.length = 0
    } else {
      // Le texte de TOUT le tour (B4), chemins bruts remplacés par le nom de l'écran (B5).
      reply = scrubPaths(turnText(seen), l)
      if (final.stop_reason === 'max_tokens' || final.stop_reason === 'pause_turn') reply = `${reply}\n\n${tr(l, 'assistant.tooLong')}`.trim()
      else if (final.stop_reason === 'tool_use') reply = `${reply}\n\n${tr(l, 'assistant.tooManySteps')}`.trim()
      // Jamais muette : une carte se présente, un écran ouvert se dit dans le fil (« Page ouverte »), sinon une phrase.
      if (!reply) reply = actions.some((a) => a.type === 'confirm') ? tr(l, 'assistant.proposal')
        : actions.some((a) => a.type === 'navigate') ? '' : tr(l, 'assistant.empty')
      // Sans raisonnement du modèle dans l'historique renvoyé, comme dans le texte affiché.
      messages = withoutReasoning([...history, ...turn])
    }
    await completeUsage(ctx, reservation.id, { ok: true, ...usage, tools: used, duration_ms: Date.now() - started,
      error: final.stop_reason === 'end_turn' ? null : final.stop_reason })
    // Ce qu'il reste de la formule gratuite après ce tour (L5) ; sans limite, rien à relire. Une relecture qui échoue ne
    // gâche pas la réponse : la bulle relit le compteur à sa prochaine ouverture.
    const allowance = reservation.budget === null ? { limited: false } : await allowanceFor(ctx).catch(() => null)
    return c.json({ messages, reply, actions, allowance })
  } catch (e: any) {
    const f = failureOf(e, deadline)
    console.error('[assistant]', f.code)
    await completeUsage(ctx, reservation.id, { ok: false, ...usage, tools: used, error: f.code, duration_ms: Date.now() - started })
    const [status, code] = FAILURE[f.kind]
    throw new HttpError(status, code)
  }
})

/**
 * La formule gratuite et ce qu'il en reste ce mois-ci (29.10.2026, L5), lu par la bulle à son ouverture. Une formule
 * sans limite : `{ limited: false }`. Lecture seule, sans appel au modèle.
 */
app.get('/allowance', async (c) => c.json({ allowance: await allowanceFor(c.get('ctx')) }))

/** Les refus des routes dits sur la carte, dans la langue de la personne (server/i18n, `assistant.error.*`). */
const CONFIRM_ERRORS = new Set(['forbidden', 'not_found', 'invalid_input', 'plan_limit_projects', 'already_invoiced', 'other_project',
  'unknown_reference', 'conflict', 'dependency_cycle', 'dependency_other_project', 'self_dependency', 'last_column', 'unknown_column',
  'end_before_start', 'invalid_timezone', 'not_from_crmlead', 'operation_not_allowed', 'lead_required', 'person_proof', 'not_opened',
  'no_seat', 'not_linked', 'sends_outside', 'restarts_client_updates'])
// tr(l, 'assistant.error.forbidden') tr(l, 'assistant.error.not_found') tr(l, 'assistant.error.invalid_input')
// tr(l, 'assistant.error.plan_limit_projects') tr(l, 'assistant.error.already_invoiced') tr(l, 'assistant.error.other_project')
// tr(l, 'assistant.error.unknown_reference') tr(l, 'assistant.error.conflict') tr(l, 'assistant.error.dependency_cycle')
// tr(l, 'assistant.error.dependency_other_project') tr(l, 'assistant.error.self_dependency') tr(l, 'assistant.error.last_column')
// tr(l, 'assistant.error.unknown_column') tr(l, 'assistant.error.end_before_start') tr(l, 'assistant.error.invalid_timezone')
// tr(l, 'assistant.error.not_from_crmlead') tr(l, 'assistant.error.operation_not_allowed') tr(l, 'assistant.error.lead_required')
// tr(l, 'assistant.error.person_proof') tr(l, 'assistant.error.not_opened') tr(l, 'assistant.error.no_seat') tr(l, 'assistant.error.not_linked')
// Une écriture qui ferait partir un email (automatisation de l'entreprise) : la carte entière est refusée (lib/assistant/run.ts).
// tr(l, 'assistant.error.sends_outside')
// Une carte qui ferait entrer un projet dans le suivi périodique au client (lib/assistant/run.ts), revue à « Confirmer ».
// tr(l, 'assistant.error.restarts_client_updates')
// Les refus du jeton, chacun avec son texte (B7) : falsifié, expiré, préparé pour une autre personne, déjà utilisé.
// tr(l, 'assistant.error.token_invalid') tr(l, 'assistant.error.token_expired') tr(l, 'assistant.error.token_other_user') tr(l, 'assistant.error.token_used')

/**
 * « Confirmer » : exécute les écritures de la carte, une seule fois.
 * - `tx` : toutes dans UNE transaction (lib/assistant/run.ts) ; le numéro du jeton y est noté en premier (usage unique,
 *   deux clics simultanés : un seul passe) ; la première écriture refusée annule tout, jeton compris.
 * - `route` : une seule écriture qui appelle une autre application : numéro noté d'abord (validé), puis la route.
 * Les droits sont revérifiés par chaque route, avec la session de la personne, à ce moment-là.
 */
app.post('/confirm', async (c) => {
  const b = await body(c, z.object({ token: z.string().min(10).max(MAX_TOKEN_CHARS), locale: z.string().max(10).optional() }))
  const ctx = c.get('ctx')
  const l = isLocale(b.locale) ? b.locale : asLocale(c.get('locale'))
  const v = verifyConfirm(b.token, ctx)
  if (!v.ok) throw new HttpError(403, v.error, { message: tr(l, `assistant.error.${v.error}`) })
  const p = v.payload
  const labels = [...new Set(p.ops.map(opLabel))].slice(0, 50)
  const tool = p.ops.length === 1 ? labels[0] : `${p.tool} ×${p.ops.length}`
  if (!p.ops.every((op) => opAllowed(op, p.mode))) {
    await logConfirm(ctx, tool, 'operation_not_allowed')
    throw new HttpError(403, 'operation_not_allowed', { message: tr(l, 'assistant.error.operation_not_allowed') })
  }
  // Usage unique (B13) : le numéro du jeton est noté AVANT d'écrire (`on conflict do nothing` : de deux « Confirmer »
  // simultanés, un seul le note). En mode `tx`, il est noté dans la transaction même des écritures, dont chaque route
  // relit les droits : un refus annule tout, numéro compris, et la carte n'est pas usée.
  const nonce = async (db: Db) => (await db.query(
    `insert into assistant_confirmations (nonce, account_id, user_id) values ($1, $2, $3) on conflict (nonce) do nothing`,
    [p.n, ctx.accountId, ctx.userId])).rowCount
  const used = () => new HttpError(403, 'token_used', { message: tr(l, 'assistant.error.token_used') })
  let ids: Record<string, string> = {}
  let outcome: ReturnType<typeof routeOutcome> = { ok: true, line: null }
  try {
    if (p.mode === 'route') {
      if (!(await withTenant(ctx, nonce))) throw used()
      const run = await runOps(sessionCookie(c), ctx, p.ops, 'route')
      ids = run.ids
      // La route a répondu 200 : a-t-elle vraiment abouti (facturation par projet, synchronisation) ?
      outcome = routeOutcome(p.ops[0], run.results[0]?.body, l)
    } else {
      ids = (await runOps(sessionCookie(c), ctx, p.ops, 'tx', { first: async (db) => { if (!(await nonce(db))) throw used() } })).ids
    }
  } catch (e) {
    if (e instanceof HttpError) throw e
    if (e instanceof OpFailure) {
      await logConfirm(ctx, tool, e.code)
      // Le refus dans la langue de la personne ; pour un lot, la place de l'écriture refusée (et rien n'est enregistré).
      const why = tr(l, CONFIRM_ERRORS.has(e.code) ? `assistant.error.${e.code}` : 'assistant.error.refused')
      const message = p.ops.length > 1 ? `${why} ${tr(l, 'assistant.batchFailed', { i: e.index + 1, n: p.ops.length })}` : why
      return c.json({ ok: false, error: e.code, message }, (e.status >= 400 && e.status < 600 ? e.status : 400) as any)
    }
    await logConfirm(ctx, tool, String((e as Error)?.message ?? 'error').slice(0, 80))
    throw e
  }
  if (!outcome.ok) {
    // Le jeton est consommé (la route a été appelée) mais rien n'a abouti : la carte le dit, sans « fait ».
    await logConfirm(ctx, tool, outcome.code ?? 'route_not_done')
    return c.json({ ok: false, error: outcome.code ?? 'route_not_done', message: outcome.line }, 502)
  }
  await logConfirm(ctx, tool, null)
  // La page à ouvrir et les liens de la carte, références remplacées par les identifiants créés.
  const at = (path: string | null | undefined) => {
    if (!path) return null
    const real = path.replace(/@([A-Za-z0-9_:.-]+)/g, (m, k) => ids[k] ?? m)
    return pageAllowed(real) ? real : null
  }
  const links = (p.links ?? []).map((l) => ({ label: l.label, path: at(l.path) })).filter((l): l is { label: string; path: string } => Boolean(l.path))
  const done = tr(l, 'assistant.confirmed', { title: p.summary.title })
  const message = p.mode === 'route' ? (outcome.line ? `${done} ${outcome.line}` : done)
    : p.ops.length === 1 ? done : `${done} ${doneLine(p.ops, l)}`
  // La langue de l'interface vient de changer : l'écran la prend sur place (comme le sélecteur de langue).
  const locale = p.ops.find((op) => op.method === 'POST' && op.path === '/api/me/locale')?.body.locale
  // La page à ouvrir, avec son nom (B5) : la bulle écrit « Page ouverte : <nom> » quand elle y va.
  const path = at(p.open)
  const label = path ? await labelOf(sessionCookie(c), path, isLocale(locale) ? locale : l) : null
  return c.json({ ok: true, message, path, label, links, ...(typeof locale === 'string' ? { locale } : {}) })
})

export default app
