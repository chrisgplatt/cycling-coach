import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateDossier } from '@/lib/claude/dossier'
import type { TrainingEvent } from '@/types'

export const dynamic = 'force-dynamic'

function isThreeAm(timezone: string, now: Date): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const localHour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
    return localHour === 3
  } catch {
    return false
  }
}

function localDateStr(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runAt = new Date()
  console.log('[cron/dossier] started at', runAt.toISOString())

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  async function log(
    userId: string | null,
    event: string,
    status: 'ok' | 'error' | 'skipped',
    details?: Record<string, unknown>,
  ) {
    await supabase
      .from('cron_logs')
      .insert({
        run_at: runAt.toISOString(),
        user_id: userId,
        event: `dossier_${event}`,
        status,
        details: details ?? null,
      })
      .then(({ error }) => {
        if (error) console.error('[cron/dossier] log error:', error.message)
      })
  }

  const { data: profiles, error: profilesError } = await supabase
    .from('user_profile')
    .select('user_id, goals, current_ftp, weight_kg, events, timezone')

  if (profilesError) {
    await log(null, 'start', 'error', { error: profilesError.message })
    return NextResponse.json({ error: profilesError.message }, { status: 500 })
  }

  await log(null, 'start', 'ok', { profiles_found: profiles?.length ?? 0 })

  let updated = 0

  for (const profile of profiles ?? []) {
    if (!profile.user_id) continue

    const tz = (profile.timezone as string | null) ?? 'Europe/London'

    if (!isThreeAm(tz, runAt)) continue

    const today = localDateStr(tz, runAt)

    // Skip if already synthesized today
    const { data: existing } = await supabase
      .from('athlete_dossier')
      .select('synthesized_at, explicit_notes')
      .eq('user_id', profile.user_id)
      .maybeSingle()

    if (existing?.synthesized_at && localDateStr(tz, new Date(existing.synthesized_at)) === today) {
      console.log(`[cron/dossier] user ${profile.user_id}: already synthesized today, skipping`)
      await log(profile.user_id, 'skipped_already_done', 'skipped', { date: today })
      continue
    }

    console.log(`[cron/dossier] synthesizing for user ${profile.user_id}`)

    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0]

      const [
        { data: workouts },
        { data: feedbacks },
        { data: chatMessages },
      ] = await Promise.all([
        supabase
          .from('workouts')
          .select('date, type, duration_minutes, tss, status, missed_reason')
          .eq('user_id', profile.user_id)
          .in('status', ['completed', 'skipped'])
          .gte('date', ninetyDaysAgo)
          .order('date'),
        supabase
          .from('session_feedback')
          .select('created_at, feedback_text')
          .eq('user_id', profile.user_id)
          .gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString())
          .order('created_at'),
        supabase
          .from('chat_messages')
          .select('role, content')
          .eq('user_id', profile.user_id)
          .order('created_at', { ascending: false })
          .limit(100),
      ])

      const eventResults = ((profile.events ?? []) as TrainingEvent[]).filter(
        e => e.icu_activity_id,
      )

      const content = await generateDossier(
        (profile.goals as string) ?? '',
        (profile.current_ftp as number) ?? 200,
        (profile.weight_kg as number) ?? 70,
        'No inline fitness data — see workout history.',
        (workouts ?? []) as Array<{
          date: string
          type: string
          duration_minutes: number
          tss: number | null
          status: string
          missed_reason: string | null
        }>,
        (feedbacks ?? []) as Array<{ created_at: string; feedback_text: string }>,
        eventResults,
        ((chatMessages ?? []) as Array<{ role: string; content: string }>).reverse(),
      )

      const explicitNotes = (existing?.explicit_notes ?? []) as Array<{
        note: string
        added_at: string
      }>

      const { error: upsertError } = await supabase.from('athlete_dossier').upsert(
        {
          user_id: profile.user_id,
          synthesized_at: runAt.toISOString(),
          content,
          explicit_notes: explicitNotes,
        },
        { onConflict: 'user_id' },
      )
      if (upsertError) {
        throw new Error(`upsert failed: ${upsertError.message}`)
      }

      updated++
      console.log(`[cron/dossier] user ${profile.user_id}: synthesis complete`)
      await log(profile.user_id, 'synthesized', 'ok')
    } catch (err) {
      console.error(`[cron/dossier] failed for user ${profile.user_id}:`, err)
      await log(profile.user_id, 'synthesis_failed', 'error', { error: String(err) })
      // Leave existing dossier untouched on failure
    }
  }

  await log(null, 'done', 'ok', { updated })
  console.log(`[cron/dossier] done: updated=${updated}`)
  return NextResponse.json({ ok: true, updated })
}
