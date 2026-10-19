import type { SupabaseClient } from '@supabase/supabase-js'
import { loadEquityScreenerBundle } from './equityScreenerData'
import { loadTridentBundle } from './tridentData'
import { joinResearchRows } from './researchModel'

export async function loadResearchBundle(client: SupabaseClient) {
  const [equity, trident] = await Promise.allSettled([loadEquityScreenerBundle(client), loadTridentBundle(client)])
  const q = equity.status === 'fulfilled' ? equity.value : null
  const t = trident.status === 'fulfilled' ? trident.value : null
  const messages: string[] = []
  if (!q) messages.push('Lecteur valorisation indisponible. Aucun score de remplacement n’est calculé.')
  else if (q.status === 'SCHEMA_PENDING') messages.push('Contrat du lecteur valorisation indisponible. Schéma non modifié.')
  if (!t) messages.push('Lecteur Trident indisponible. Admissibilité et critères non attestés.')
  return {
    rows: joinResearchRows(q?.rows ?? [], t?.rows ?? [], q?.status !== 'SCHEMA_PENDING' && Boolean(q && t)), messages,
    status: !t && (!q || q.status === 'SCHEMA_PENDING') ? 'ERROR' as const : messages.length ? 'PARTIAL' as const : 'READY' as const,
    equity: q, trident: t,
  }
}
