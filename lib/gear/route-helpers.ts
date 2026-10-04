import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function getAuthed() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? { supabase, user } : null
}

export const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
export const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 })
export const notFound = (what: string) => NextResponse.json({ error: `${what} not found` }, { status: 404 })
export const serverError = (error: string) => NextResponse.json({ error }, { status: 500 })

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}
