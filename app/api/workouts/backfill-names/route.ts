import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { nameForWorkout } from '@/lib/workout-names'
import type { WorkoutStep } from '@/types'

// Admin-only one-off: fill `name` for plan-associated workouts created before the
// session-naming feature shipped (name IS NULL). Unplanned/imported rides (plan_id
// IS NULL) are excluded — they're outside this naming scheme. DB-only: no re-push to
// intervals.icu, since these are historical/already-scheduled workouts, not new ones.
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('is_admin')
    .maybeSingle()

  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: missing, error: fetchError } = await supabase
    .from('workouts')
    .select('id, type, duration_minutes, steps')
    .not('plan_id', 'is', null)
    .is('name', null)

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })

  const workouts = missing ?? []
  if (!workouts.length) {
    return NextResponse.json({ total: 0, updated: 0, failed: 0 })
  }

  let updated = 0, failed = 0
  for (const w of workouts) {
    const steps = (w.steps as WorkoutStep[] | null) ?? []
    const name = nameForWorkout(w.type, w.duration_minutes, steps)
    const { error } = await supabase.from('workouts').update({ name }).eq('id', w.id)
    if (error) failed++; else updated++
  }

  return NextResponse.json({ total: workouts.length, updated, failed })
}
