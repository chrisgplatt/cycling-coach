import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateBriefing } from '@/lib/claude/briefing'
import { sendPush } from '@/lib/push'
import { IntervalsClient } from '@/lib/intervals/client'
import type { Workout, TrainingEvent, BriefingContext } from '@/types'

export const dynamic = 'force-dynamic'

function readinessLabel(tsb: number | null): BriefingContext['readinessLabel'] {
  if (tsb === null) return 'Unknown'
  if (tsb > 0) return 'Ready'
  if (tsb >= -30) return 'Moderate'
  return 'Fatigued'
}

function isNotificationTime(notifTime: string, timezone: string): boolean {
  try {
    const now = new Date()
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const h = parts.find(p => p.type === 'hour')?.value.padStart(2, '0') ?? '00'
    const m = parts.find(p => p.type === 'minute')?.value.padStart(2, '0') ?? '00'
    return `${h}:${m}` === notifTime.slice(0, 5)
  } catch {
    return false
  }
}


export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Service role client bypasses RLS — needed to read all users
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const today = new Date().toISOString().split('T')[0]
  const nowISO = new Date().toISOString()

  const { data: profiles } = await supabase
    .from('user_profile')
    .select('user_id, intervals_icu_athlete_id, intervals_icu_api_key, events, notification_time, timezone')
    .eq('notifications_enabled', true)

  let sent = 0

  for (const profile of profiles ?? []) {
    if (!profile.user_id) continue

    // Skip if it's not this user's notification time in their timezone
    const notifTime = (profile.notification_time as string | null) ?? '07:00:00'
    const tz = (profile.timezone as string | null) ?? 'Europe/London'
    if (!isNotificationTime(notifTime, tz)) continue

    // Skip if already notified today
    const { data: existing } = await supabase
      .from('daily_briefings')
      .select('id, coach_note, notification_sent_at')
      .eq('user_id', profile.user_id)
      .eq('date', today)
      .maybeSingle()
    if (existing?.notification_sent_at) continue

    let ctl: number | null = null
    let atl: number | null = null
    let tsb: number | null = null
    let hrv: number | null = null
    let recentWorkouts: BriefingContext['recentWorkouts'] = []

    const { data: workouts } = await supabase
      .from('workouts')
      .select('*')
      .eq('date', today)
      .eq('status', 'planned')
      .order('created_at')
      .limit(1)
    const todayWorkout = (workouts?.[0] as Workout | undefined) ?? null

    const fourWeeks = new Date(Date.now() + 28 * 864e5).toISOString().split('T')[0]
    const upcomingEvents = ((profile.events ?? []) as TrainingEvent[]).filter(
      (e: TrainingEvent) => e.date >= today && e.date <= fourWeeks
    )

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
      } catch { /* proceed without ICU data */ }
    }

    const ctx: BriefingContext = {
      todayWorkout,
      workoutCompleted: false,
      completedRide: null,
      ctl, atl, tsb,
      readinessLabel: readinessLabel(tsb),
      hrv, recentWorkouts, upcomingEvents,
    }

    let coach_note = existing?.coach_note ?? null
    if (!coach_note) {
      try {
        coach_note = await generateBriefing(ctx)
      } catch {
        coach_note = todayWorkout
          ? `You have a ${todayWorkout.type} session today — ${todayWorkout.duration_minutes} minutes.`
          : 'Rest day today. Recover well.'
      }
    }

    await supabase
      .from('daily_briefings')
      .upsert(
        { user_id: profile.user_id, date: today, coach_note, notification_sent_at: nowISO, generated_at: nowISO },
        { onConflict: 'user_id,date' }
      )

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', profile.user_id)

    const firstSentence = coach_note.split(/[.!?]/)[0].trim().slice(0, 100)
    const body = todayWorkout
      ? `${firstSentence} · ${todayWorkout.type} today`
      : `${firstSentence} · Rest day`

    for (const sub of subs ?? []) {
      try {
        await sendPush(sub, { title: 'My Cycling Coach', body, url: '/dashboard' })
        sent++
      } catch (err: unknown) {
        if ((err as { statusCode?: number }).statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        }
      }
    }
  }

  return NextResponse.json({ ok: true, sent })
}
