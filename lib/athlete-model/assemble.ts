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
