import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { importUnplannedRides } from '@/lib/intervals/import-rides'
import { backfillActivityMetrics } from '@/lib/intervals/enrich'
import { maybeGenerateProgressBrief } from '@/lib/progress/brief-generator'
import { GarminClient } from '@/lib/garmin/client'
import type { ICUActivity, GarminWellness } from '@/types'

async function syncGarmin(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase-server').createSupabaseServerClient>>,
  userId: string,
  garminEmail: string,
  garminPassword: string,
  cachedToken: object | null,
  todayStr: string,
): Promise<GarminWellness | null> {
  let client: GarminClient
  let freshToken: object

  try {
    if (cachedToken) {
      client = await GarminClient.fromToken(cachedToken)
    } else {
      client = await GarminClient.fromCredentials(garminEmail, garminPassword)
    }
    freshToken = client.exportToken()
  } catch {
    // Token expired — try fresh login
    try {
      client = await GarminClient.fromCredentials(garminEmail, garminPassword)
      freshToken = client.exportToken()
    } catch (err) {
      console.error('[sync] Garmin auth failed:', err)
      return null
    }
  }

  // Persist refreshed token (fire-and-forget, non-fatal)
  supabase
    .from('user_profile')
    .update({ garmin_oauth_token: freshToken })
    .eq('user_id', userId)
    .then(() => {}, (err: unknown) => console.error('[sync] token save failed:', err))

  const [readiness, status, battery, stress] = await Promise.all([
    client.getTrainingReadiness(todayStr),
    client.getTrainingStatus(todayStr),
    client.getBodyBatteryCurrent(todayStr),
    client.getDailyStressAvg(todayStr),
  ])

  const row = {
    user_id: userId,
    date: todayStr,
    garmin_training_readiness: readiness,
    garmin_training_status: status,
    garmin_body_battery_current: battery,
    garmin_stress_avg: stress,
    synced_at: new Date().toISOString(),
  }

  await supabase
    .from('garmin_wellness')
    .upsert(row, { onConflict: 'user_id,date' })
    .then(() => {}, (err: unknown) => console.error('[sync] garmin_wellness upsert failed:', err))

  return {
    date: todayStr,
    garmin_training_readiness: readiness,
    garmin_training_status: status,
    garmin_body_battery_current: battery,
    garmin_stress_avg: stress,
  }
}

export async function POST(req: Request) {
  // ?deep=1 runs a one-time backfill over ALL completed history (not just 90 days),
  // so older rides get distributions too. Routine syncs stay scoped to 90 days.
  const deep = new URL(req.url).searchParams.get('deep') === '1'

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp, weight_kg, goals, min_sessions_per_week, garmin_email, garmin_password, garmin_oauth_token')
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
          min_sessions_per_week: profile.min_sessions_per_week ?? 3,
        })
      } catch { /* non-fatal — brief generation failure must not block sync */ }
    }

    const todayStr = new Date().toISOString().split('T')[0]

    // Garmin sync (sequential after intervals.icu, non-fatal)
    let garmin_today: GarminWellness | null = null
    if (profile.garmin_email && profile.garmin_password) {
      try {
        garmin_today = await syncGarmin(
          supabase,
          user.id,
          profile.garmin_email,
          profile.garmin_password,
          (profile.garmin_oauth_token as object | null) ?? null,
          todayStr,
        )
      } catch (err) {
        console.error('[sync] Garmin sync error:', err)
      }
    }

    return NextResponse.json({
      ...syncData,
      athlete_id: profile.intervals_icu_athlete_id,
      backfill,
      ...(garmin_today ? { garmin_today } : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
