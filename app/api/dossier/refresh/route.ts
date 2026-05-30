import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { synthesizeDossier } from '@/lib/claude/synthesize-dossier'
import type { TrainingEvent } from '@/types'

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('goals, current_ftp, weight_kg, events')
    .maybeSingle()

  if (!profile) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })

  try {
    await synthesizeDossier(supabase, {
      user_id: user.id,
      goals: (profile.goals as string | null) ?? '',
      current_ftp: (profile.current_ftp as number | null) ?? null,
      weight_kg: (profile.weight_kg as number | null) ?? null,
      events: (profile.events as TrainingEvent[] | null) ?? null,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[dossier/refresh] synthesis failed:', err)
    return NextResponse.json({ error: 'Failed to refresh notes' }, { status: 500 })
  }
}
