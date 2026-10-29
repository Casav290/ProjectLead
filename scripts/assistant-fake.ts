/**
 * Faux service de modèle (HTTP local, ANTHROPIC_BASE_URL) pour les contrôles de l'alignement des bulles (28.10.2026) :
 * aucune clé réelle, aucun appel extérieur. Il garde chaque requête reçue (en-têtes, corps) pour vérifier ce que le
 * serveur envoie (marqueurs de cache, outils, historique).
 *
 * Il joue un scénario selon le texte de la DERNIÈRE demande de la personne du tour :
 *   FAKE:<outil>:<entrée JSON>  demande l'outil, puis répond « RESULTAT <résultat de l'outil> » ;
 *   LENT:<ms>                   répond après <ms> millisecondes (délai du tour) ;
 *   HTTP400 / HTTP529           le service refuse le fil (400) / est saturé (529) ;
 *   TABLEAU                     un texte plein de balisage (tableau, <br>, titre, gras, code, <script>) ;
 *   MULTI                       texte + outil, puis un second texte (le texte de tout le tour) ; un texte répété (doublon) ;
 *   MUET                        aucun texte (réponse de repli) ;
 *   REFUS                       stop_reason « refusal » ;
 *   COUPE                       stop_reason « max_tokens » au milieu d'un appel d'outil ;
 *   CHEMIN                      un texte qui écrit des chemins bruts de l'application ;
 *   RAISONNEMENT                un raisonnement entre balises avant le texte (<reasoning>, <thinking>, <analysis>, balise
 *                               ouvrante orpheline), avec un outil au milieu (Suites du 29.10.2026) ;
 *   sinon                       « Bonjour. ».
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export type Seen = { headers: Record<string, any>; body: any }

const textOf = (content: unknown): string => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((b: any) => (b?.type === 'text' ? b.text : '')).join(' ') : '')

export async function startFake() {
  const seen: Seen[] = []
  const server: Server = createServer((req, res) => {
    let d = ''
    req.on('data', (x) => (d += x))
    req.on('end', async () => {
      const body = JSON.parse(d || '{}')
      seen.push({ headers: req.headers, body })
      res.setHeader('content-type', 'application/json')
      const msgs = (body.messages ?? []) as any[]
      const last = msgs[msgs.length - 1]
      const results = Array.isArray(last?.content) ? last.content.filter((b: any) => b.type === 'tool_result') : []
      // La demande du tour : le dernier message de la personne qui n'est pas un résultat d'outil.
      const ask = [...msgs].reverse().find((m) => m.role === 'user' && textOf(m.content).trim())
      const text = textOf(ask?.content)
      const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 30 }
      const msg = (content: any[], stop_reason: string) => res.end(JSON.stringify({ id: `msg_${seen.length}`, type: 'message', role: 'assistant',
        model: body.model, content, stop_reason, stop_sequence: null, usage }))
      const fail = (status: number, type: string) => { res.statusCode = status; res.end(JSON.stringify({ type: 'error', error: { type, message: 'faux service' } })) }

      const lent = text.match(/LENT:(\d+)/)
      if (lent) { await new Promise((r) => setTimeout(r, Number(lent[1]))); return msg([{ type: 'text', text: 'Trop tard.' }], 'end_turn') }
      if (text.includes('HTTP400')) return fail(400, 'invalid_request_error')
      if (text.includes('HTTP529')) return fail(529, 'overloaded_error')
      if (text.includes('REFUS')) return msg([], 'refusal')
      if (text.includes('MUET')) return msg([], 'end_turn')
      if (text.includes('COUPE')) return msg([{ type: 'text', text: 'Je prépare un long plan.' },
        { type: 'tool_use', id: 'toolu_coupe', name: 'list_projects', input: {} }], 'max_tokens')
      if (text.includes('TABLEAU')) return msg([{ type: 'text', text: [
        '# Vos projets', '', '| Projet | État |', '|---|:---:|', '| **Alpha** | en cours |', '| Beta | terminé |',
        'Première ligne<br>Deuxième ligne<br/>Troisième', '```', 'code', '```', 'Fin <script>alert(1)</script> : voilà !'].join('\n') }], 'end_turn')
      if (text.includes('CHEMIN')) {
        const id = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? '00000000-0000-4000-8000-000000000000'
        return msg([{ type: 'text', text: `Allez dans /reglages/equipe, ou sur https://projectlead.io/projets/${id}/gantt. Voir aussi [le Gantt](/projets/${id}/gantt).` }], 'end_turn')
      }
      if (text.includes('RAISONNEMENT')) {
        if (results.length) return msg([{ type: 'text', text: '<thinking>\nLa personne veut supprimer.\n</thinking>\n<Analysis>Pas d’outil pour cela.</Analysis>'
          + 'Je ne supprime rien moi-même.\n<reasoning>note orpheline jusqu’à la fin de la ligne\nOuvrez le projet pour le faire.' }], 'end_turn')
        return msg([{ type: 'text', text: '<reasoning>Respond in French, tu.</reasoning>Je regarde vos projets.' },
          { type: 'tool_use', id: 'toolu_raison', name: 'list_projects', input: {} }], 'tool_use')
      }
      if (text.includes('MULTI')) {
        if (results.length) return msg([{ type: 'text', text: 'Je regarde vos projets.' }, { type: 'text', text: 'Voici le résumé.' }], 'end_turn')
        return msg([{ type: 'text', text: 'Je regarde vos projets.' }, { type: 'tool_use', id: 'toolu_multi', name: 'list_projects', input: {} }], 'tool_use')
      }
      if (results.length) {
        const txt = results.map((r: any) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))).join('\n')
        return msg([{ type: 'text', text: `RESULTAT ${txt}` }], 'end_turn')
      }
      const m = text.match(/FAKE:([a-z_]+):(\{.*\})/)
      if (!m) return msg([{ type: 'text', text: 'Bonjour.' }], 'end_turn')
      return msg([{ type: 'tool_use', id: `toolu_${seen.length}`, name: m[1], input: JSON.parse(m[2]) }], 'tool_use')
    })
  })
  const port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port)))
  return { url: `http://127.0.0.1:${port}`, seen, close: () => server.close() }
}
