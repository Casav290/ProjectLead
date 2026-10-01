import type { Context } from 'hono'
import { Hono } from 'hono'
import { z, type ZodTypeAny } from 'zod'
import { type Ctx, type Db, withTenant } from '../db.js'

export type Env = { Variables: { ctx: Ctx; name: string; email: string } }

export const router = () => new Hono<Env>()

/** Une erreur métier qui doit arriver à l'écran telle quelle. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, public extra: Record<string, unknown> = {}) {
    super(code)
  }
}

export const notFound = () => new HttpError(404, 'not_found')
export const forbidden = () => new HttpError(403, 'forbidden')

/** Lit et valide le corps JSON. Un refus dit quel champ, pas seulement « invalide ». */
export async function body<S extends ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  const raw = await c.req.json().catch(() => { throw new HttpError(400, 'invalid_json') })
  const r = schema.safeParse(raw)
  if (!r.success) {
    throw new HttpError(400, 'invalid_input', {
      fields: Object.fromEntries(r.error.issues.map((i) => [i.path.join('.') || '_', i.message])),
    })
  }
  return r.data
}

export const tx = <T>(c: Context<Env>, fn: (db: Db, ctx: Ctx) => Promise<T>) => {
  const ctx = c.get('ctx')
  return withTenant(ctx, (db) => fn(db, ctx))
}

export function requireRole(c: Context<Env>, ...roles: Ctx['role'][]) {
  if (!roles.includes(c.get('ctx').role)) throw forbidden()
}

// Champs communs.
export const uuid = z.string().uuid()
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const optDate = date.nullable().optional()
export const cents = z.number().int().min(0).max(1e12)
export const text = (max: number) => z.string().trim().max(max)
export const name = (max = 200) => z.string().trim().min(1).max(max)
export const email = z.string().trim().toLowerCase().email().max(254)

/** Les colonnes d'un `update` construites depuis un objet partiel validé. */
export function setClause(patch: Record<string, unknown>, allowed: readonly string[], start = 1) {
  const keys = Object.keys(patch).filter((k) => allowed.includes(k) && patch[k] !== undefined)
  return {
    sql: keys.map((k, i) => `${k} = $${start + i}`).join(', '),
    values: keys.map((k) => patch[k]),
    keys,
  }
}

/** camelCase → snake_case pour les clés d'un objet. */
export const snake = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()), v]))
