import type { WorkoutType, WorkoutStatus } from '@/types'

// "Solid pill" style — bg-100/text-700, no border. Used in modal headers
// and plan-preview lists.
export const WORKOUT_TYPE_BADGE: Record<WorkoutType, string> = {
  endurance: 'bg-blue-100 text-blue-700',
  threshold: 'bg-orange-100 text-orange-700',
  intervals: 'bg-red-100 text-red-700',
  recovery:  'bg-emerald-100 text-emerald-700',
  test:      'bg-violet-100 text-violet-700',
}

// "Bordered chip" style — bg-50/text-700 + border. Used in compact list cards.
export const WORKOUT_TYPE_CHIP: Record<WorkoutType, string> = {
  endurance: 'bg-blue-50 text-blue-700 border border-blue-200',
  threshold: 'bg-orange-50 text-orange-600 border border-orange-200',
  intervals: 'bg-red-50 text-red-600 border border-red-200',
  recovery:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
  test:      'bg-violet-50 text-violet-700 border border-violet-200',
}

export const WORKOUT_STATUS_LABEL: Record<WorkoutStatus, string> = {
  planned:      'Planned',
  completed:    '✓ Completed',
  skipped:      'Missed',
  needs_review: 'Needs review',
}

// "Solid pill" style for status — used in modal headers (no "planned" entry;
// the modal never shows a status chip for planned workouts).
export const WORKOUT_STATUS_BADGE: Partial<Record<WorkoutStatus, string>> = {
  completed:    'bg-emerald-100 text-emerald-700',
  skipped:      'bg-red-100 text-red-600',
  needs_review: 'bg-amber-100 text-amber-700',
}

// "Bordered chip" style for status — used in compact list cards.
export const WORKOUT_STATUS_CHIP: Record<WorkoutStatus, string> = {
  planned:      'bg-gray-100 text-gray-500 border border-gray-200',
  completed:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  skipped:      'bg-red-50 text-red-600 border border-red-200',
  needs_review: 'bg-amber-50 text-amber-700 border border-amber-200',
}
