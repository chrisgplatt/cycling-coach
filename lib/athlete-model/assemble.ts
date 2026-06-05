// Pure transforms from stored DB rows into the inputs the grounding calculations
// expect. No Supabase/Anthropic imports — the orchestrator owns the fetching.
import type { WorkoutType, FeedbackCompletion } from '@/types'

// Monday (UTC) of the week containing date 'YYYY-MM-DD'.
function mondayOf(date: string): string {
  const t = new Date(date + 'T00:00:00Z')
  const dow = (t.getUTCDay() + 6) % 7 // 0 = Monday
  t.setUTCDate(t.getUTCDate() - dow)
  return t.toISOString().slice(0, 10)
}

// Weekly TSS totals in chronological order. Null TSS counts as 0.
export function weeklyTssSeries(workouts: Array<{ date: string; tss: number | null }>): number[] {
  const byWeek = new Map<string, number>()
  for (const w of workouts) {
    const wk = mondayOf(w.date)
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + (w.tss ?? 0))
  }
  return [...byWeek.keys()].sort().map(k => byWeek.get(k)!)
}

// Representative prescribed intensity (%FTP) per workout type — the midpoint of the
// type's working zone, used to judge whether a reported RPE was high or low for the
// session that was set.
export const TYPE_TARGET_PCT: Record<WorkoutType, number> = {
  recovery: 52,
  endurance: 68,
  threshold: 98,
  intervals: 112,
}

export function rpeSessionsFromFeedback(
  rows: Array<{ rpe: number | null; type: WorkoutType | null }>,
): Array<{ rpe: number; targetPct: number }> {
  return rows
    .filter((r): r is { rpe: number; type: WorkoutType } => r.rpe != null && r.type != null)
    .map(r => ({ rpe: r.rpe, targetPct: TYPE_TARGET_PCT[r.type] }))
}

export const HARD_TYPES = new Set<WorkoutType>(['threshold', 'intervals'])

export function recoverySessions(
  rows: Array<{
    date: string; type: WorkoutType; status: string
    completion: FeedbackCompletion | null; feel: number | null
  }>,
): Array<{ date: string; isHard: boolean; completedWell: boolean; feel: number | null }> {
  return rows.map(r => ({
    date: r.date,
    isHard: HARD_TYPES.has(r.type),
    completedWell: r.completion != null
      ? r.completion === 'as_planned' || r.completion === 'went_harder'
      : r.status === 'completed',
    feel: r.feel,
  }))
}
