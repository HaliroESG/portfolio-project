import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '../../../lib/supabase/server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  if (code) {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL('/', url.origin))
  }
  return NextResponse.redirect(new URL('/auth/error', url.origin))
}
