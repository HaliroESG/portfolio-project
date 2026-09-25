"use client"

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function LogoutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const logout = async () => {
    setPending(true)
    await supabase.auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={pending}
      title="Se déconnecter"
      aria-label="Se déconnecter"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
    >
      <LogOut size={16} />
    </button>
  )
}
