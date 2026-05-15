import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export function isEmailAllowed(email: string, allowedEmails: string): boolean {
  const allowed = allowedEmails
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes(email.toLowerCase())
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user?.email) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const allowedEmails = process.env.ALLOWED_EMAILS ?? ''
  if (!isEmailAllowed(data.user.email, allowedEmails)) {
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/login?error=not_invited`)
  }

  return NextResponse.redirect(`${origin}/dashboard`)
}
