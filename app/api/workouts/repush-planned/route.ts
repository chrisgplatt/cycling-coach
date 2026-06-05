import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import type { WorkoutStep, CoachingNotes } from '@/types'

// Re-pushes every planned workout's structured steps to intervals.icu so they pick
// up the current workout-notation format (e.g. open-ended `press lap` warm-ups and
// recoveries). Existing events are updated in place via updateEventFull, keeping the
// same event id; planned workouts that have steps but were never pushed get a new
// event created. Workouts without stored steps are skipped (no notation to refresh).
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let includePast = false
  try {
    const body = await req.json()
    includePast = body?.includePast === true
  } catch { /* empty body is fine */ }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('is_admin, intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!profile.intervals_icu_athlete_id || !profile.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const today = new Date().toISOString().slice(0, 10)
  let query = supabase
    .from('workouts')
    .select('id, date, type, duration_minutes, description, target_zones, steps, intervals_icu_event_id, coaching_notes')
    .eq('status', 'planned')
    .order('date', { ascending: true })
  if (!includePast) query = query.gte('date', today)

  const { data: workouts, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  const results = { total: workouts?.length ?? 0, updated: 0, created: 0, skipped: 0, failed: 0 }
  const failures: Array<{ date: string; error: string }> = []

  for (const w of workouts ?? []) {
    const steps = (w.steps as WorkoutStep[] | null) ?? []
    if (!steps.length) { results.skipped++; continue }

    const name = `${w.type.charAt(0).toUpperCase() + w.type.slice(1)} — ${w.duration_minutes}min`
    const description = `${w.description}\n\nTarget: ${w.target_zones}`
    const note = (w.coaching_notes as CoachingNotes | null)?.summary

    try {
      if (w.intervals_icu_event_id) {
        await client.updateEventFull(w.intervals_icu_event_id, {
          name,
          description,
          duration_minutes: w.duration_minutes,
          steps,
          note,
        })
        results.updated++
      } else {
        const newEventId = await client.createEvent({
          date: w.date,
          name,
          description,
          duration_minutes: w.duration_minutes,
          steps,
          note,
        })
        await supabase.from('workouts').update({ intervals_icu_event_id: newEventId }).eq('id', w.id)
        results.created++
      }
    } catch (err) {
      results.failed++
      failures.push({ date: w.date, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ ok: true, ...results, failures })
}
