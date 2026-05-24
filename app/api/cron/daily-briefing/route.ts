import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateBriefing } from '@/lib/claude/briefing'
import { sendPush } from '@/lib/push'
import { sendBriefingEmail } from '@/lib/email'
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
    const localTime = `${h}:${m}`
    const matches = localTime === notifTime.slice(0, 5)
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

  console.log('[cron] daily-briefing started at', new Date().toISOString())

  // Service role client bypasses RLS — needed to read all users
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const nowISO = new Date().toISOString()

  const { data: profiles, error: profilesError } = await supabase
    .from('user_profile')
    .select('user_id, intervals_icu_athlete_id, intervals_icu_api_key, events, notification_time, timezone')
    .eq('notifications_enabled', true)

  if (profilesError) {
    console.error('[cron] failed to fetch profiles:', profilesError.message)
    return NextResponse.json({ error: profilesError.message }, { status: 500 })
  }

  console.log(`[cron] found ${profiles?.length ?? 0} profile(s) with notifications enabled`)

  let pushSent = 0
  let emailSent = 0

  for (const profile of profiles ?? []) {
    if (!profile.user_id) continue

    const notifTime = (profile.notification_time as string | null) ?? '07:00:00'
    const tz = (profile.timezone as string | null) ?? 'Europe/London'
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())

    if (!isNotificationTime(notifTime, tz)) {
      console.log(`[cron] user ${profile.user_id}: not their notification time, skipping`)
      continue
    }

    // Skip if already notified today
    const { data: existing } = await supabase
      .from('daily_briefings')
      .select('id, coach_note, notification_sent_at')
      .eq('user_id', profile.user_id)
      .eq('date', today)
      .maybeSingle()

    if (existing?.notification_sent_at) {
      console.log(`[cron] user ${profile.user_id}: already notified today, skipping`)
      continue
    }

    console.log(`[cron] user ${profile.user_id}: generating briefing`)

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
    console.log(`[cron] user ${profile.user_id}: today's workout=${todayWorkout?.type ?? 'none'}`)

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
        console.log(`[cron] user ${profile.user_id}: ICU data fetched, CTL=${ctl} ATL=${atl} TSB=${tsb}`)
      } catch (err) {
        console.error(`[cron] user ${profile.user_id}: ICU fetch failed:`, err)
      }
    } else {
      console.log(`[cron] user ${profile.user_id}: no ICU credentials, skipping fitness data`)
    }

    const ctx: BriefingContext = {
      today,
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
        console.log(`[cron] user ${profile.user_id}: briefing generated (${coach_note.length} chars)`)
      } catch (err) {
        console.error(`[cron] user ${profile.user_id}: generateBriefing failed:`, err)
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
        { user_id: profile.user_id, date: today, coach_note, notification_sent_at: nowISO, generated_at: nowISO },
        { onConflict: 'user_id,date' }
      )

    // Push notifications
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', profile.user_id)

    console.log(`[cron] user ${profile.user_id}: found ${subs?.length ?? 0} push subscription(s)`)

    const firstSentence = coach_note.split(/[.!?]/)[0].trim().slice(0, 100)
    const pushBody = todayWorkout
      ? `${firstSentence} · ${todayWorkout.type} today`
      : `${firstSentence} · Rest day`

    for (const sub of subs ?? []) {
      try {
        await sendPush(sub, { title: 'My Cycling Coach', body: pushBody, url: '/dashboard' })
        pushSent++
        console.log(`[cron] user ${profile.user_id}: push sent OK`)
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode
        console.error(`[cron] user ${profile.user_id}: push failed (status ${statusCode}):`, err)
        if (statusCode === 410) {
          console.log(`[cron] user ${profile.user_id}: subscription expired, deleting`)
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
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
        } else {
          console.log(`[cron] user ${profile.user_id}: no email address found, skipping email`)
        }
      } catch (err) {
        console.error(`[cron] user ${profile.user_id}: email failed:`, err)
      }
    } else {
      console.log('[cron] RESEND_API_KEY not set, skipping email')
    }
  }

  console.log(`[cron] done: pushSent=${pushSent} emailSent=${emailSent}`)
  return NextResponse.json({ ok: true, pushSent, emailSent })
}
