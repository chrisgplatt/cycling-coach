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
}

interface Props {
  workout: Workout
  onFeedback?: (workout: Workout) => void
}

export default function WorkoutCard({ workout, onFeedback }: Props) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${TYPE_COLOURS[workout.type]}`}>
            {workout.type}
          </span>
          <span className="text-sm text-gray-500">{workout.duration_minutes} min</span>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLOURS[workout.status]}`}>
          {workout.status}
        </span>
      </div>
      <p className="text-sm text-gray-700">{workout.description}</p>
      <p className="text-xs text-gray-400">{workout.target_zones}</p>
      {workout.status === 'completed' && onFeedback && (
        <button
          onClick={() => onFeedback(workout)}
          className="text-xs text-blue-600 hover:underline"
        >
          Log feedback
        </button>
      )}
    </div>
  )
}
