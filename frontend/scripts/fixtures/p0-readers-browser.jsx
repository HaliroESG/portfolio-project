import React from 'react'
import { createRoot } from 'react-dom/client'
import { SWRConfig, useSWRConfig } from 'swr'
import FXPage from '../../app/fx/page'
import Currencies from '../../app/currencies/page'
import Macro from '../../app/mdss/page'
import Publications from '../../app/publications/page'
import { MacroStrip } from '../../components/MacroStrip'
import { failReads } from './p0-readers-supabase'

function Fixture() {
  const { mutate } = useSWRConfig()
  const Page = { '/fx': FXPage, '/currencies': Currencies, '/mdss': Macro, '/publications': Publications }[location.pathname] ?? Publications
  return <>
    <header className="bg-amber-100 p-3 text-sm text-black">TEST LOCAL · Données synthétiques · aucun accès fournisseur
      <button type="button" className="ml-3 border p-1" onClick={() => { failReads(); void mutate(() => true).catch(() => {}) }}>Simuler erreur de relecture</button>
    </header>
    {location.pathname === '/mdss' && <MacroStrip />}
    <Page />
  </>
}
createRoot(document.getElementById('root')).render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false, revalidateOnFocus: false, revalidateOnReconnect: false, refreshInterval: 0 }}><Fixture /></SWRConfig>)
