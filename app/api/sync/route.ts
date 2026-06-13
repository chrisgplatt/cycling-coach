import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { importUnplannedRides } from '@/lib/intervals/import-rides'
import { backfillActivityMetrics } from '@/lib/intervals/enrich'
import { maybeGenerateProgressBrief } from '@/lib/progress/brief-generator'
import type { ICUActivity } from '@/types'

export async function POST(req: Request) {
  // ?deep=1 runs a one-time backfill over ALL completed history (not just 90 days),
  // so older rides get distributions too. Routine syncs stay scoped to 90 days.
  const deep = new URL(req.url).searchParams.get('deep') === '1'

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp, weight_kg, goals')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured in settings' }, { status: 400 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  try {
    const syncData = await client.sync(6)

    const actsByDate = new Map<string, ICUActivity[]>()
    for (const act of syncData.activities) {
      const date = act.start_date_local.split('T')[0]
      const existing = actsByDate.get(date) ?? []
      actsByDate.set(date, [...existing, act])
    }

    const { data: pending } = await supabase
      .from('workouts')
      .select('id, date')
      .in('status', ['planned', 'needs_review'])
      .is('icu_activity_id', null)

    if (pending?.length) {
      await Promise.all(
        pending
          .map(w => {
            const acts = (actsByDate.get(w.date) ?? [])
              .filter(a => /ride/i.test(a.type))
            if (acts.length === 0) return null
            const best = acts.reduce((a, b) =>
              (b.training_load ?? 0) > (a.training_load ?? 0) ? b : a
            )
            return supabase
              .from('workouts')
              .update({
                icu_activity_id: best.id,
                tss: best.training_load,
                status: acts.length === 1 ? 'completed' : 'needs_review',
              })
              .eq('id', w.id)
          })
          .filter(Boolean)
      )
    }

    // Create workout rows for unplanned rides not already in the DB
    await importUnplannedRides(supabase, user.id, syncData.activities)

    // Self-healing: enrich completed rides (incl. those just imported/matched) with
    // power/terrain/interval detail. Capped per run; newest first. Non-fatal.
    // The result is surfaced in the response so backfill progress is observable.
    let backfill: import('@/lib/intervals/enrich').BackfillResult | { error: string } | null = null
    try {
      backfill = await backfillActivityMetrics(supabase, client, user.id, { allTime: deep })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[sync] activity-metrics backfill failed:', err)
      backfill = { error: message }
    }

    // Generate progress brief (4h debounce, non-fatal)
    if (profile.current_ftp && profile.weight_kg) {
      try {
        await maybeGenerateProgressBrief(supabase, user.id, syncData, {
          current_ftp: profile.current_ftp,
          weight_kg: profile.weight_kg,
          goals: profile.goals ?? '',
        })
      } catch { /* non-fatal — brief generation failure must not block sync */ }
    }

    return NextResponse.json({ ...syncData, athlete_id: profile.intervals_icu_athlete_id, backfill })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
