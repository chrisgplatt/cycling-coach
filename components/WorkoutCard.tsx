import type { Workout, WorkoutType } from '@/types'

const TYPE_COLOURS: Record<WorkoutType, string> = {
  endurance: 'bg-blue-100 text-blue-700',
  threshold: 'bg-orange-100 text-orange-700',
  intervals: 'bg-red-100 text-red-700',
  recovery: 'bg-emerald-100 text-emerald-700',
}

const STATUS_COLOURS = {
  planned: 'bg-slate-100 text-slate-500',
  completed: 'bg-emerald-100 text-emerald-700',
  skipped: 'bg-red-100 text-red-600',
  needs_review: 'bg-amber-100 text-amber-700',
}

const STATUS_LABELS = {
  planned: 'planned',
  completed: 'completed',
  skipped: 'skipped',
  needs_review: 'needs review',
}

interface Props {
  workout: Workout
  onClick?: () => void
}

export default function WorkoutCard({ workout, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-slate-100 shadow-sm p-4 space-y-2 transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md hover:border-blue-200' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${TYPE_COLOURS[workout.type]}`}>
            {workout.type}
          </span>
          <span className="text-xs text-slate-500 font-medium">{workout.duration_minutes} min</span>
          {workout.tss !== null && (
            <span className="text-xs text-slate-400 px-2 py-0.5 rounded-full bg-slate-50 border border-slate-100">
              TSS {workout.tss}
            </span>
          )}
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${STATUS_COLOURS[workout.status]}`}>
          {STATUS_LABELS[workout.status]}
        </span>
      </div>
      <p className="text-sm text-slate-700 leading-snug">{workout.description}</p>
      <p className="text-xs text-slate-400">{workout.target_zones}</p>
    </div>
  )
}
