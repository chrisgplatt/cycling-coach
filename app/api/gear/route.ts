import { NextResponse } from 'next/server'
import { loadGearState } from '@/lib/gear/load'
import { buildGearView } from '@/lib/gear/view'
import { getAuthed, unauthorized, serverError } from '@/lib/gear/route-helpers'

export async function GET() {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  try {
    const state = await loadGearState(auth.supabase, auth.user.id)
    return NextResponse.json({ bikes: buildGearView(state) })
  } catch (err) {
    return serverError(err instanceof Error ? err.message : 'Failed to load gear')
  }
}
