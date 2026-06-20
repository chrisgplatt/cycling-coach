// Throwaway analysis script — reads real session_feedback + athlete_dossier data to
// see what subjective signal exists on recent threshold/intervals workouts, as input
// to the FTP-prediction redesign discussion. Not wired into the app.
//
// Run: SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/ftp-feedback-check.ts

import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

let supabaseUrl = process.env.SUPABASE_URL
if (!supabaseUrl) {
  for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^SUPABASE_URL=(.*)$/)
    if (m) supabaseUrl = m[1]
  }
}

async function main() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: usersResp, error: usersError } = await supabase.auth.admin.listUsers()
  if (usersError) { console.error('listUsers failed:', usersError); return }
  const user = usersResp.users.find(u => u.email === 'chrisgplatt@googlemail.com')
  if (!user) { console.error('No user found with that email'); return }

  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString()

  const [{ data: workouts }, { data: feedbacks }, { data: dossier }] = await Promise.all([
    supabase.from('workouts')
      .select('id, date, type')
      .eq('user_id', user.id)
      .gte('date', cutoff.slice(0, 10)),
    supabase.from('session_feedback')
      .select('created_at, workout_id, feedback_text, rpe, feel, completion, tags')
      .eq('user_id', user.id)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false }),
    supabase.from('athlete_dossier')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const thresholdWorkoutIds = new Set(
    (workouts ?? []).filter(w => w.type === 'threshold' || w.type === 'intervals').map(w => w.id)
  )

  console.log(`Found ${workouts?.length ?? 0} workouts in last 90 days, ${thresholdWorkoutIds.size} threshold/intervals.`)
  console.log(`Found ${feedbacks?.length ?? 0} total feedback entries in last 90 days.\n`)

  console.log('--- Feedback on threshold/intervals workouts specifically ---')
  const relevant = (feedbacks ?? []).filter(f => f.workout_id && thresholdWorkoutIds.has(f.workout_id))
  if (!relevant.length) {
    console.log('  None found — no session_feedback rows linked to a threshold/intervals workout_id.')
  }
  for (const f of relevant) {
    console.log(`  ${f.created_at.slice(0, 10)} | rpe=${f.rpe} feel=${f.feel} completion=${f.completion} tags=${JSON.stringify(f.tags)}`)
    console.log(`    "${f.feedback_text}"`)
  }
  console.log()

  console.log('--- ALL feedback in last 90 days (in case workout_id linkage is sparse) ---')
  for (const f of (feedbacks ?? [])) {
    console.log(`  ${f.created_at.slice(0, 10)} | workout_id=${f.workout_id ?? 'null'} rpe=${f.rpe} feel=${f.feel}`)
    console.log(`    "${f.feedback_text}"`)
  }
  console.log()

  console.log('--- athlete_dossier ---')
  if (!dossier) {
    console.log('  No dossier row found.')
  } else {
    console.log(`  synthesized_at: ${dossier.synthesized_at}`)
    console.log(JSON.stringify(dossier.content, null, 2))
  }
}

main().catch(err => {
  console.error('Failed:', err)
  process.exit(1)
})
