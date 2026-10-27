import Anthropic from '@anthropic-ai/sdk'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import { SESSION_COOKIE } from '../auth.js'
import { withTenant } from '../db.js'
import { body, HttpError, router } from '../lib/http.js'
import { localDay } from '../lib/time.js'
import { asLocale, isLocale, tr } from '../lib/i18n.js'
import { callApi } from '../lib/assistant/internal.js'
import { dynamicSystem, STABLE_SYSTEM } from '../lib/assistant/prompt.js'
import { completeUsage, logConfirm, reserveMessage } from '../lib/assistant/quota.js'
import { buildTools, type AssistantAction } from '../lib/assistant/tools.js'
import { opAllowed, verifyConfirm } from '../lib/assistant/token.js'

/**
 * Assistant IA (bulle en bas à droite, cahier commun des applications Lead du 24.10.2026).
 *
 * POST /api/assistant          { messages, page, locale } → { messages, reply, actions }
 * POST /api/assistant/confirm  { token }                  → exécute l'écriture proposée, une seule fois
 *
 * Session obligatoire (garde de server/index.ts : 401 sinon). Clé ANTHROPIC_API_KEY absente : 503, et la bulle est
 * masquée (`features.assistant` de /api/me). Rien de la conversation n'est gardé en base : le navigateur renvoie
 * l'historique à chaque tour ; seuls jetons, outils et erreurs sont journalisés (`assistant_usage`).
 */
const app = router()

export const MODEL = 'claude-opus-5-5'
export const MAX_TOKENS = 4000
export const MAX_ITERATIONS = 10

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

/** Les blocs « fallback » sont de simples marqueurs (modèle de repli) : on ne les renvoie pas au tour suivant. */
const clean = (messages: Anthropic.Beta.BetaMessageParam[]) => messages.map((m) => (Array.isArray(m.content)
  ? { ...m, content: (m.content as any[]).filter((b) => b?.type !== 'fallback') }
  : m))

app.post('/', async (c) => {
  if (!assistantConfigured()) throw new HttpError(503, 'assistant_not_configured')
  if (!process.env.APP_SECRET) throw new HttpError(503, 'app_secret_missing')
  const b = await body(c, chatSchema)
  if (JSON.stringify(b.messages).length > MAX_HISTORY_BYTES) throw new HttpError(413, 'conversation_too_long')
  // Le tour demandé : un message de la personne, en texte (les notes de l'écran, « confirmé » / « annulé », sont du texte).
  const last = b.messages[b.messages.length - 1]
  const lastOk = last.role === 'user' && (typeof last.content === 'string'
    || (last.content as unknown[]).every((x) => textBlock.safeParse(x).success))
  if (!lastOk) throw new HttpError(400, 'invalid_input', { fields: { messages: 'le dernier message doit être un texte de la personne' } }) // i18n-ok

  const ctx = c.get('ctx')
  const reservation = await reserveMessage(ctx)
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
  const tools = buildTools({ cookie: sessionCookie(c), ctx, actions, used })
  const history: Anthropic.Beta.BetaMessageParam[] = clean(b.messages as Anthropic.Beta.BetaMessageParam[])
  const started = Date.now()
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }

  try {
    const client = new Anthropic({ maxRetries: 1, timeout: 55_000 })
    const runner = client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'low' },
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
    }, { signal: AbortSignal.timeout(240_000) })   // la fonction Vercel a 300 s ; 10 tours au plus
    const turn: Anthropic.Beta.BetaMessageParam[] = []
    let final: Anthropic.Beta.BetaMessage | null = null
    const texts: string[] = []
    for await (const message of runner) {
      final = message
      usage.input_tokens += message.usage.input_tokens ?? 0
      usage.output_tokens += message.usage.output_tokens ?? 0
      usage.cache_read_tokens += message.usage.cache_read_input_tokens ?? 0
      usage.cache_write_tokens += message.usage.cache_creation_input_tokens ?? 0
      if (message.stop_reason === 'refusal') break
      for (const blk of message.content) if (blk.type === 'text' && blk.text.trim()) texts.push(blk.text.trim())
      if (message.stop_reason === 'max_tokens') {
        // Réponse coupée : un appel d'outil inachevé ne doit pas rester dans l'historique (le tour suivant serait refusé).
        const kept = message.content.filter((blk) => blk.type === 'text')
        turn.push({ role: 'assistant', content: kept.length ? kept : [{ type: 'text', text: '…' }] })
        break
      }
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
      reply = tr(l, 'assistant.refusal')
      // Le tour refusé n'est pas renvoyé : la demande et une réponse neutre seulement.
      messages = [...history, { role: 'assistant', content: [{ type: 'text', text: reply }] }]
      actions.length = 0
    } else {
      const lastText = final.content.filter((blk) => blk.type === 'text').map((blk: any) => blk.text.trim()).filter(Boolean).join('\n\n')
      reply = lastText || texts.join('\n\n')
      if (final.stop_reason === 'max_tokens') reply = `${reply}\n\n${tr(l, 'assistant.tooLong')}`.trim()
      else if (final.stop_reason === 'tool_use') reply = `${reply}\n\n${tr(l, 'assistant.tooManySteps')}`.trim()
      if (!reply) reply = actions.some((a) => a.type === 'confirm') ? tr(l, 'assistant.proposal') : tr(l, 'assistant.done')
      messages = [...history, ...turn]
    }
    await completeUsage(ctx, reservation.id, { ok: true, ...usage, tools: used, duration_ms: Date.now() - started,
      error: final.stop_reason === 'end_turn' ? null : final.stop_reason })
    return c.json({ messages, reply, actions })
  } catch (e: any) {
    const code = e instanceof Anthropic.RateLimitError ? 'rate_limited'
      : e instanceof Anthropic.APIError ? `api_${e.status ?? 'error'}` : String(e?.message ?? 'error').slice(0, 80)
    console.error('[assistant]', code)
    await completeUsage(ctx, reservation.id, { ok: false, ...usage, tools: used, error: code, duration_ms: Date.now() - started })
    throw new HttpError(e instanceof Anthropic.RateLimitError ? 503 : 502, 'assistant_unavailable')
  }
})

/** Les refus des routes, dits en clair sur la carte, dans la langue de la personne (server/i18n, `assistant.error.*`). */
const CONFIRM_ERRORS = new Set(['forbidden', 'not_found', 'invalid_input', 'plan_limit_projects', 'already_invoiced', 'other_project',
  'unknown_reference', 'conflict'])
// tr(l, 'assistant.error.forbidden') tr(l, 'assistant.error.not_found') tr(l, 'assistant.error.invalid_input')
// tr(l, 'assistant.error.plan_limit_projects') tr(l, 'assistant.error.already_invoiced') tr(l, 'assistant.error.other_project')
// tr(l, 'assistant.error.unknown_reference') tr(l, 'assistant.error.conflict')

app.post('/confirm', async (c) => {
  const b = await body(c, z.object({ token: z.string().min(10).max(20_000), locale: z.string().max(10).optional() }))
  const ctx = c.get('ctx')
  const l = isLocale(b.locale) ? b.locale : asLocale(c.get('locale'))
  const v = verifyConfirm(b.token, ctx)
  if (!v.ok) throw new HttpError(403, v.error)
  const op = v.payload.op
  const tool = `${op.method} ${op.path.replace(/[0-9a-f-]{36}/g, ':id')}`
  if (!opAllowed(op)) { await logConfirm(ctx, tool, 'operation_not_allowed'); throw new HttpError(403, 'operation_not_allowed') }
  // Usage unique : le numéro du jeton est noté avant d'exécuter (deux clics simultanés : un seul passe).
  const fresh = await withTenant(ctx, async (db) => (await db.query(
    `insert into assistant_confirmations (nonce, account_id, user_id) values ($1, $2, $3) on conflict (nonce) do nothing`,
    [v.payload.n, ctx.accountId, ctx.userId])).rowCount)
  if (!fresh) throw new HttpError(403, 'token_used')
  // La route existante, avec la session de la personne : droits revérifiés maintenant.
  const r = await callApi(sessionCookie(c), op.method, op.path, op.body)
  if (r.status >= 400) {
    const code = r.body?.error ?? `http_${r.status}`
    await logConfirm(ctx, tool, code)
    return c.json({ ok: false, error: code, message: tr(l, CONFIRM_ERRORS.has(code) ? `assistant.error.${code}` : 'assistant.error.refused') }, r.status as any)
  }
  await logConfirm(ctx, tool, null)
  const id: string | undefined = r.body?.id
  let path: string | null = null
  if (op.method === 'POST' && op.path === '/api/tasks' && id) path = `/projets/${op.body.project_id}?tache=${id}`
  else if (op.method === 'POST' && op.path === '/api/projects' && id) path = `/projets/${id}`
  else if (op.method === 'POST' && op.path === '/api/clients' && id) path = `/clients/${id}`
  else if (op.path.startsWith('/api/projects/')) path = `/projets/${op.path.split('/')[3]}`
  return c.json({ ok: true, message: tr(l, 'assistant.confirmed', { title: v.payload.summary.title }), path })
})

export default app
