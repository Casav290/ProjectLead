import type { Hono } from 'hono'

/**
 * Les outils de l'assistant n'ont AUCUN accès propre à la base : ils appellent les routes existantes de ProjectLead
 * (`/api/...`), dans le même processus, avec le cookie de session de la personne connectée. Mêmes contrôles que l'écran
 * (session, rôle, RLS de l'entreprise, projets réservés, limites de la formule) : l'assistant ne peut rien que la
 * personne ne puisse faire elle-même, et aucun chemin ne contourne un contrôle.
 */
let app: Hono<any> | null = null

/** Appelé une fois par server/index.ts, une fois l'application montée (évite l'import circulaire). */
export function bindAssistantApp(a: Hono<any>) { app = a }

export type ApiResult = { status: number; body: any }

export async function callApi(sessionCookie: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown): Promise<ApiResult> {
  if (!app) throw new Error('assistant_app_unbound')
  if (!path.startsWith('/api/') || path.startsWith('/api/assistant')) throw new Error('assistant_path_refused')
  const headers: Record<string, string> = { cookie: sessionCookie }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await app.request(`http://internal${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, body: json }
}
