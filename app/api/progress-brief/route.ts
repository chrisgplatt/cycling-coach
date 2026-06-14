import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  return d.toISOString().split('T')[0]
}

function computeStreak(
  workouts: { date: string; status: string }[],
  minSessionsPerWeek: number,
): number {
  const today = new Date().toISOString().split('T')[0]
  const currentWeekStart = getWeekStart(today)
  const weekMap = new Map<string, number>()
  for (const w of workouts) {
    const ws = getWeekStart(w.date)
    if (ws >= currentWeekStart) continue
    if (!weekMap.has(ws)) weekMap.set(ws, 0)
    if (w.status === 'completed') weekMap.set(ws, weekMap.get(ws)! + 1)
  }
  if (weekMap.size === 0) return 0
  const weeks = [...weekMap.keys()].sort((a, b) => b.localeCompare(a))
  let count = 0
  for (const ws of weeks) {
    if (weekMap.get(ws)! >= minSessionsPerWeek) count++
    else break
  }
  return count
}

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data }, { data: plan }, { data: profile }] = await Promise.all([
    supabase
      .from('progress_briefs')
      .select('content, metrics_snapshot, generated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('training_plans')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('user_profiles')
      .select('min_sessions_per_week')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  if (!data) return NextResponse.json(null)

  // If the stored metrics_snapshot is missing streak (old cached data), compute it fresh.
  if (data.metrics_snapshot && data.metrics_snapshot.streak == null && plan) {
    const { data: workouts } = await supabase
      .from('workouts')
      .select('date, status')
      .eq('plan_id', plan.id)

    if (workouts) {
      const minPerWeek = profile?.min_sessions_per_week ?? 3
      const streak = computeStreak(workouts, minPerWeek)
      data.metrics_snapshot = { ...data.metrics_snapshot, streak }
    }
  }

  return NextResponse.json(data)
}
