import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateCoachingNotes, type WorkoutForNotes } from '@/lib/claude/coaching-notes'
import type { UserProfile } from '@/types'

// Admin-only one-off: fill coaching_notes for the user's planned workouts that don't
// have any yet (workouts created before the feature). Notes for new plans are baked in
// at plan time, so this is just for backfilling existing plans.
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('is_admin, current_ftp, weight_kg, goals')
    .maybeSingle()

  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: missing } = await supabase
    .from('workouts')
    .select('id, date, type, description, target_zones, steps')
    .eq('status', 'planned')
    .is('coaching_notes', null)

  const workouts = (missing ?? []) as WorkoutForNotes[]
  if (!workouts.length) {
    return NextResponse.json({ total: 0, updated: 0, skipped: 0, failed: 0 })
  }

  let notes: Record<string, { summary: string; focus: { label: string; detail: string }[] }>
  try {
    notes = await generateCoachingNotes(profile as unknown as UserProfile, workouts)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Generation failed' }, { status: 502 })
  }

  let updated = 0, failed = 0
  for (const w of workouts) {
    const note = notes[w.id]
    if (!note) { failed++; continue }
    const { error } = await supabase.from('workouts').update({ coaching_notes: note }).eq('id', w.id)
    if (error) failed++; else updated++
  }

  return NextResponse.json({ total: workouts.length, updated, skipped: workouts.length - updated - failed, failed })
}
