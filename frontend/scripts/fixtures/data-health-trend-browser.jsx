import React from 'react'
import { createRoot } from 'react-dom/client'
import { DataHealthPanel } from '../../components/DataHealthPanel'

createRoot(document.getElementById('root')).render(
  <main className="mx-auto max-w-6xl p-4">
    <h1 className="mb-2 text-xl font-bold">ASTROCYTE — Data health offline QA</h1>
    <p className="mb-4 text-sm">Synthetic fixtures only. No Supabase connection or command activation.</p>
    <DataHealthPanel />
  </main>
)
