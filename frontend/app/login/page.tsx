"use client"

import { ArrowRight, KeyRound, Landmark } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: false,
      },
    })
    setPending(false)
    if (authError) {
      setError(authError.message)
      return
    }
    setSent(true)
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950 dark:bg-[#080A0F] dark:text-white">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[1fr_420px]">
        <section className="max-w-xl">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-emerald-400 text-slate-950">
            <Landmark size={22} />
          </div>
          <h1 className="mt-7 text-4xl font-black tracking-normal sm:text-5xl">Portfolio Office</h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-600 dark:text-gray-400">
            Accès privé au registre patrimonial, aux performances, aux risques et au cycle de décision.
          </p>
          <div className="mt-8 grid max-w-lg grid-cols-3 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 dark:border-white/10 dark:bg-white/10">
            {['Ledger vérifié', 'Consolidation EUR', 'Décisions tracées'].map((label) => (
              <div key={label} className="bg-white px-3 py-4 text-center text-[10px] font-black uppercase text-slate-600 dark:bg-[#0D1117] dark:text-gray-300">
                {label}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#0D1117]">
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5 text-emerald-500" />
            <div>
              <h2 className="text-base font-black">Connexion propriétaire</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">Lien sécurisé à usage unique</p>
            </div>
          </div>

          {sent ? (
            <div className="mt-7 border-l-2 border-emerald-500 pl-4">
              <div className="text-sm font-black">Email envoyé</div>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-gray-400">
                Ouvrez le lien reçu à l’adresse autorisée pour accéder au portefeuille.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-7 space-y-4">
              <label className="block">
                <span className="text-[10px] font-black uppercase text-slate-500 dark:text-gray-400">Email autorisé</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-2 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-white/10 dark:bg-black/20"
                />
              </label>
              {error && <p className="text-xs font-medium text-red-600 dark:text-red-300">{error}</p>}
              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300"
              >
                {pending ? 'Envoi…' : 'Recevoir le lien'}
                {!pending && <ArrowRight size={16} />}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}
