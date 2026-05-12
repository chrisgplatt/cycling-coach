import type { Workout, WorkoutType } from '@/types'

const TYPE_COLOURS: Record<WorkoutType, string> = {
  endurance: 'bg-blue-100 text-blue-800',
  threshold: 'bg-orange-100 text-orange-800',
  intervals: 'bg-red-100 text-red-800',
  recovery: 'bg-green-100 text-green-800',
}

const STATUS_COLOURS = {
  planned: 'bg-gray-100 text-gray-600',
  completed: 'bg-green-100 text-green-700',
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
      className={`bg-white rounded-lg border border-gray-200 p-4 space-y-2 ${onClick ? 'cursor-pointer hover:border-blue-400' : ''}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${TYPE_COLOURS[workout.type]}`}>
            {workout.type}
          </span>
          <span className="text-sm text-gray-500">{workout.duration_minutes} min</span>
          {workout.tss !== null && (
            <span className="text-xs text-gray-400 px-2 py-1 rounded-full bg-gray-50 border border-gray-200">
              TSS {workout.tss}
            </span>
          )}
        </div>
        <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLOURS[workout.status]}`}>
          {STATUS_LABELS[workout.status]}
        </span>
      </div>
      <p className="text-sm text-gray-700">{workout.description}</p>
      <p className="text-xs text-gray-400">{workout.target_zones}</p>
    </div>
  )
}
