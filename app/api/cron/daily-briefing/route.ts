import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateBriefing } from '@/lib/claude/briefing'
import { fetchActiveBeliefs, formatAthleteModel } from '@/lib/claude/athlete-model'
import { sendPush } from '@/lib/push'
import { sendBriefingEmail } from '@/lib/email'
import { IntervalsClient } from '@/lib/intervals/client'
import { fetchDailyForecast } from '@/lib/weather/open-meteo'
import { fetchHrvStatusBestSource } from '@/lib/hrv/server'
import type { Workout, TrainingEvent, BriefingContext } from '@/types'

export const dynamic = 'force-dynamic'

function readinessLabel(tsb: number | null): BriefingContext['readinessLabel'] {
  if (tsb === null) return 'Unknown'
  if (tsb > 0) return 'Ready'
  if (tsb >= -30) return 'Moderate'
  return 'Fatigued'
}

// Crons run at the top of the hour, so match on hour only — this tolerates Vercel's
// timing jitter (typically <2 min) without risking double-firing (crons are 1h apart).
function isNotificationTime(notifTime: string, timezone: string): boolean {
  try {
    const now = new Date()
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const localHour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
    const localMinute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)
    const notifHour = parseInt(notifTime.slice(0, 2), 10)
    const localTime = `${String(localHour).padStart(2, '0')}:${String(localMinute).padStart(2, '0')}`
    const matches = localHour === notifHour
    console.log(`[cron] time check: local=${localTime} setting=${notifTime.slice(0, 5)} tz=${timezone} match=${matches}`)
    return matches
  } catch (err) {
    console.error('[cron] isNotificationTime error:', err)
    return false
  }
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runAt = new Date()
  console.log('[cron] daily-briefing started at', runAt.toISOString())

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  async function log(userId: string | null, event: string, status: 'ok' | 'error' | 'skipped', details?: Record<string, unknown>) {
    await supabase.from('cron_logs').insert({
      run_at: runAt.toISOString(),
      user_id: userId,
      event,
      status,
      details: details ?? null,
    }).then(({ error }) => {
      if (error) console.error('[cron] failed to write log:', error.message)
    })
  }

  const nowISO = runAt.toISOString()

  const { data: profiles, error: profilesError } = await supabase
    .from('user_profile')
    .select('user_id, intervals_icu_athlete_id, intervals_icu_api_key, events, unavailability, notification_time, timezone, latitude, longitude, garmin_email')
    .eq('notifications_enabled', true)

  if (profilesError) {
    console.error('[cron] failed to fetch profiles:', profilesError.message)
    await log(null, 'cron_start', 'error', { error: profilesError.message })
    return NextResponse.json({ error: profilesError.message }, { status: 500 })
  }

  const profileCount = profiles?.length ?? 0
  console.log(`[cron] found ${profileCount} profile(s) with notifications enabled`)
  await log(null, 'cron_start', 'ok', { profiles_found: profileCount, run_at: nowISO })

  let pushSent = 0
  let emailSent = 0

  for (const profile of profiles ?? []) {
    if (!profile.user_id) continue

    const notifTime = (profile.notification_time as string | null) ?? '07:00:00'
    const tz = (profile.timezone as string | null) ?? 'Europe/London'
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())

    if (!isNotificationTime(notifTime, tz)) {
      console.log(`[cron] user ${profile.user_id}: not their notification time, skipping`)
      await log(profile.user_id, 'time_mismatch', 'skipped', { notification_time: notifTime, timezone: tz, today })
      continue
    }

    const { data: existing } = await supabase
      .from('daily_briefings')
      .select('id, coach_note, verdict, headline, notification_sent_at')
      .eq('user_id', profile.user_id)
      .eq('date', today)
      .maybeSingle()

    if (existing?.notification_sent_at) {
      console.log(`[cron] user ${profile.user_id}: already notified today, skipping`)
      await log(profile.user_id, 'already_notified', 'skipped', { date: today })
      continue
    }

    console.log(`[cron] user ${profile.user_id}: generating briefing`)

    let ctl: number | null = null
    let atl: number | null = null
    let tsb: number | null = null
    let hrv: number | null = null
    let hrvStatus: BriefingContext['hrvStatus'] = null
    let recentWorkouts: BriefingContext['recentWorkouts'] = []

    const { data: workouts } = await supabase
      .from('workouts')
      .select('*')
      .eq('user_id', profile.user_id)
      .eq('date', today)
      .eq('status', 'planned')
      .order('created_at')
      .limit(1)
    const todayWorkout = (workouts?.[0] as Workout | undefined) ?? null
    console.log(`[cron] user ${profile.user_id}: today's workout=${todayWorkout?.type ?? 'none'}`)

    const fourWeeks = new Date(Date.now() + 28 * 864e5).toISOString().split('T')[0]
    const upcomingEvents = ((profile.events ?? []) as TrainingEvent[]).filter(
      (e: TrainingEvent) => e.date >= today && e.date <= fourWeeks
    )

    if (profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      const garminParams = profile.garmin_email ? { supabase, userId: profile.user_id } : null
      hrvStatus = await fetchHrvStatusBestSource(today, garminParams, client).catch(() => null)
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
        console.log(`[cron] user ${profile.user_id}: ICU data fetched, CTL=${ctl} ATL=${atl} TSB=${tsb}`)
      } catch (err) {
        console.error(`[cron] user ${profile.user_id}: ICU fetch failed:`, err)
        await log(profile.user_id, 'icu_fetch_failed', 'error', { error: String(err) })
      }
    } else {
      console.log(`[cron] user ${profile.user_id}: no ICU credentials, skipping fitness data`)
    }

    const activeUnavailability = ((profile.unavailability ?? []) as Array<{ type: string; start_date: string; end_date: string; notes?: string }>)
      .filter(u => u.start_date <= today && u.end_date >= today)
      .map(u => ({ type: u.type, end_date: u.end_date, notes: u.notes }))

    // Open-Meteo interprets `today` against the `tz` parameter (local midnight-to-midnight).
    let weather: BriefingContext['weather'] = null
    if (typeof profile.latitude === 'number' && typeof profile.longitude === 'number') {
      weather = await fetchDailyForecast(profile.latitude, profile.longitude, today, tz)
      console.log(`[cron] user ${profile.user_id}: weather ${weather ? weather.description : 'unavailable'}`)
      await log(profile.user_id, 'weather_fetch', weather ? 'ok' : 'skipped', { description: weather?.description ?? null })
    }

    const beliefs = await fetchActiveBeliefs(supabase, profile.user_id).catch(() => [])

    const ctx: BriefingContext = {
      today,
      todayWorkout,
      workoutCompleted: false,
      completedRide: null,
      ctl, atl, tsb,
      readinessLabel: readinessLabel(tsb),
      hrv, hrvStatus, recentWorkouts, upcomingEvents,
      activeUnavailability,
      athleteModel: formatAthleteModel(beliefs),
      weather,
      dailyStrain: null,
    }

    let coach_note = existing?.coach_note ?? null
    let verdict: string | null = existing?.verdict ?? null
    let headline: string | null = existing?.headline ?? null
    if (!coach_note) {
      try {
        const briefing = await generateBriefing(ctx)
        coach_note = briefing.coach_note
        verdict = briefing.verdict
        headline = briefing.headline
        console.log(`[cron] user ${profile.user_id}: briefing generated (${coach_note.length} chars)`)
        await log(profile.user_id, 'briefing_generated', 'ok', { chars: coach_note.length, date: today })
      } catch (err) {
        console.error(`[cron] user ${profile.user_id}: generateBriefing failed:`, err)
        await log(profile.user_id, 'briefing_failed', 'error', { error: String(err) })
        coach_note = todayWorkout
          ? `You have a ${todayWorkout.type} session today — ${todayWorkout.duration_minutes} minutes.`
          : 'Rest day today. Recover well.'
      }
    } else {
      console.log(`[cron] user ${profile.user_id}: using existing briefing note`)
    }

    await supabase
      .from('daily_briefings')
      .upsert(
        { user_id: profile.user_id, date: today, coach_note, verdict, headline, weather, notification_sent_at: nowISO, generated_at: nowISO },
        { onConflict: 'user_id,date' }
      )

    // Push notifications
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', profile.user_id)

    const subCount = subs?.length ?? 0
    console.log(`[cron] user ${profile.user_id}: found ${subCount} push subscription(s)`)

    if (subCount === 0) {
      await log(profile.user_id, 'no_subscriptions', 'skipped', { date: today })
    }

    const firstSentence = coach_note.split(/[.!?]/)[0].trim().slice(0, 100)
    const pushBody = todayWorkout
      ? `${firstSentence} · ${todayWorkout.type} today`
      : `${firstSentence} · Rest day`

    for (const sub of subs ?? []) {
      try {
        await sendPush(sub, { title: 'My Cycling Coach', body: pushBody, url: '/dashboard' })
        pushSent++
        console.log(`[cron] user ${profile.user_id}: push sent OK`)
        await log(profile.user_id, 'push_sent', 'ok', { endpoint_prefix: sub.endpoint.slice(0, 40) })
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode
        console.error(`[cron] user ${profile.user_id}: push failed (status ${statusCode}):`, err)
        await log(profile.user_id, 'push_failed', 'error', {
          status_code: statusCode,
          error: String(err),
          endpoint_prefix: sub.endpoint.slice(0, 40),
        })
        if (statusCode === 410) {
          console.log(`[cron] user ${profile.user_id}: subscription expired, deleting`)
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          await log(profile.user_id, 'subscription_deleted', 'ok', { reason: '410_gone' })
        }
      }
    }

    // Email
    if (process.env.RESEND_API_KEY) {
      try {
        const { data: authUser } = await supabase.auth.admin.getUserById(profile.user_id)
        const email = authUser?.user?.email
        if (email) {
          await sendBriefingEmail(email, coach_note, todayWorkout, today)
          emailSent++
          console.log(`[cron] user ${profile.user_id}: email sent to ${email}`)
          await log(profile.user_id, 'email_sent', 'ok', { date: today })
        } else {
          console.log(`[cron] user ${profile.user_id}: no email address found, skipping email`)
        }
      } catch (err) {
        console.error(`[cron] user ${profile.user_id}: email failed:`, err)
        await log(profile.user_id, 'email_failed', 'error', { error: String(err) })
      }
    } else {
      console.log('[cron] RESEND_API_KEY not set, skipping email')
    }
  }

  console.log(`[cron] done: pushSent=${pushSent} emailSent=${emailSent}`)
  await log(null, 'cron_done', 'ok', { push_sent: pushSent, email_sent: emailSent })
  return NextResponse.json({ ok: true, pushSent, emailSent })
}
