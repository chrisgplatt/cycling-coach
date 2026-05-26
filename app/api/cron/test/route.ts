import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'
import { generateBriefing } from '@/lib/claude/briefing'
import { sendPush } from '@/lib/push'
import { IntervalsClient } from '@/lib/intervals/client'
import type { Workout, TrainingEvent, BriefingContext } from '@/types'

function readinessLabel(tsb: number | null): BriefingContext['readinessLabel'] {
  if (tsb === null) return 'Unknown'
  if (tsb > 0) return 'Ready'
  if (tsb >= -30) return 'Moderate'
  return 'Fatigued'
}

// Runs the full briefing+push+logging flow for the authenticated user only.
// Skips the time check and already-notified guard so it can be triggered on demand.
export async function POST() {
  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const runAt = new Date()
  const logged: Array<{ event: string; status: string; details: unknown }> = []

  async function log(event: string, status: 'ok' | 'error' | 'skipped', details?: Record<string, unknown>) {
    const entry = { run_at: runAt.toISOString(), user_id: user!.id, event, status, details: details ?? null }
    logged.push({ event, status, details: details ?? null })
    const { error } = await supabase.from('cron_logs').insert(entry)
    if (error) logged.push({ event: 'log_write_failed', status: 'error', details: error.message })
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, events, timezone')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const tz = (profile.timezone as string | null) ?? 'Europe/London'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(runAt)

  await log('test_run_start', 'ok', { today, timezone: tz })

  const { data: workouts } = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .eq('status', 'planned')
    .order('created_at')
    .limit(1)
  const todayWorkout = (workouts?.[0] as Workout | undefined) ?? null

  const fourWeeks = new Date(Date.now() + 28 * 864e5).toISOString().split('T')[0]
  const upcomingEvents = ((profile.events ?? []) as TrainingEvent[]).filter(
    (e: TrainingEvent) => e.date >= today && e.date <= fourWeeks
  )

  let ctl: number | null = null
  let atl: number | null = null
  let tsb: number | null = null
  let hrv: number | null = null
  let recentWorkouts: BriefingContext['recentWorkouts'] = []

  if (profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0]
      const [wellness, activities] = await Promise.all([
        client.getWellness(sevenDaysAgo, today),
        client.getActivities(sevenDaysAgo, today),
      ])
      const latest = wellness.at(-1)
      ctl = latest?.ctl ?? null
      atl = latest?.atl ?? null
      tsb = latest?.form ?? (ctl !== null && atl !== null ? ctl - atl : null)
      hrv = latest?.hrv ?? null
      recentWorkouts = activities
        .filter(a => /ride/i.test(a.type))
        .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))
        .slice(0, 2)
        .map(a => ({
          date: a.start_date_local.split('T')[0],
          type: a.type,
          avg_power: a.average_watts ?? null,
          tss: a.training_load ?? null,
        }))
      await log('icu_fetch', 'ok', { ctl, atl, tsb })
    } catch (err) {
      await log('icu_fetch_failed', 'error', { error: String(err) })
    }
  }

  const ctx: BriefingContext = {
    today, todayWorkout, workoutCompleted: false, completedRide: null,
    ctl, atl, tsb, readinessLabel: readinessLabel(tsb), hrv, recentWorkouts, upcomingEvents,
  }

  let coach_note: string
  try {
    coach_note = await generateBriefing(ctx)
    await log('briefing_generated', 'ok', { chars: coach_note.length })
  } catch (err) {
    await log('briefing_failed', 'error', { error: String(err) })
    coach_note = todayWorkout
      ? `You have a ${todayWorkout.type} session today — ${todayWorkout.duration_minutes} minutes.`
      : 'Rest day today. Recover well.'
  }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', user.id)

  const subCount = subs?.length ?? 0
  if (subCount === 0) {
    await log('no_subscriptions', 'skipped', {})
  }

  const firstSentence = coach_note.split(/[.!?]/)[0].trim().slice(0, 100)
  const pushBody = todayWorkout
    ? `${firstSentence} · ${todayWorkout.type} today`
    : `${firstSentence} · Rest day`

  let pushSent = 0
  for (const sub of subs ?? []) {
    try {
      await sendPush(sub, { title: 'My Cycling Coach (test)', body: pushBody, url: '/dashboard' })
      pushSent++
      await log('push_sent', 'ok', { endpoint_prefix: sub.endpoint.slice(0, 40) })
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode
      await log('push_failed', 'error', { status_code: statusCode, error: String(err), endpoint_prefix: sub.endpoint.slice(0, 40) })
      if (statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        await log('subscription_deleted', 'ok', { reason: '410_gone' })
      }
    }
  }

  return NextResponse.json({ ok: true, pushSent, logged })
}
