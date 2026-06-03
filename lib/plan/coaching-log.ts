import type { ProposedAdjustment, CoachingLogEntry, WorkoutType } from '@/types'

export interface FeedbackRow {
  id: string
  created_at: string
  workout_id: string | null
  feedback_text: string
  proposed_adjustment: ProposedAdjustment | null
  approved: boolean | null
}

export interface WorkoutRef {
  date: string
  type: WorkoutType
}

/** Map raw session_feedback rows + a workout lookup into coaching-log entries. */
export function toCoachingLogEntries(
  rows: FeedbackRow[],
  workouts: Map<string, WorkoutRef>,
): CoachingLogEntry[] {
  return rows.map(r => {
    const ref = r.workout_id ? workouts.get(r.workout_id) ?? null : null
    return {
      id: r.id,
      created_at: r.created_at,
      session_date: ref?.date ?? null,
      session_type: ref?.type ?? null,
      feedback_text: r.feedback_text,
      summary: r.proposed_adjustment?.summary ?? null,
      approved: r.approved,
      had_proposal: r.proposed_adjustment !== null,
    }
  })
}
