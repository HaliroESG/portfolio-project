import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabasePublishableKey) {
  console.error("⚠️ Variables d'environnement Supabase manquantes !")
}

export const supabase = createBrowserClient(supabaseUrl, supabasePublishableKey)
