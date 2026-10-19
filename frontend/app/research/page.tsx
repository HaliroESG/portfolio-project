import { Suspense } from 'react'
import { ResearchWorkspace } from '../../components/research/ResearchWorkspace'

export default function ResearchPage() {
  return <Suspense fallback={<p role="status" className="p-8">Chargement de l’espace de recherche…</p>}><ResearchWorkspace /></Suspense>
}
