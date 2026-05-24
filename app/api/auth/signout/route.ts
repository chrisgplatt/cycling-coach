import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { cookies } from 'next/headers'

export async function POST() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()

  // Explicitly expire all Supabase auth cookies so the middleware
  // no longer sees a valid session after the next navigation.
  const cookieStore = await cookies()
  const response = NextResponse.json({ ok: true })
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith('sb-')) {
      response.cookies.set(cookie.name, '', { maxAge: 0, path: '/' })
    }
  }

  return response
}
