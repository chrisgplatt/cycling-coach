import type { Workout, WorkoutType } from '@/types'
import { deriveTargetZones } from '@/lib/claude/zones'

const IF_BY_TYPE: Record<WorkoutType, number> = {
  recovery: 0.50, endurance: 0.68, threshold: 0.85, intervals: 0.90, test: 0.90,
}

function getTss(workout: Workout): { value: number; estimated: boolean } | null {
  if (workout.tss !== null) return { value: workout.tss, estimated: false }
  if (workout.status === 'planned') {
    const if_ = IF_BY_TYPE[workout.type] ?? 0.68
    return { value: Math.round((workout.duration_minutes * 60 * if_ * if_) / 36), estimated: true }
  }
  return null
}

const TYPE_CHIPS: Record<WorkoutType, string> = {
  endurance: 'bg-blue-50 text-blue-700 border border-blue-200',
  threshold: 'bg-orange-50 text-orange-600 border border-orange-200',
  intervals: 'bg-red-50 text-red-600 border border-red-200',
  recovery:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
  test:      'bg-violet-50 text-violet-700 border border-violet-200',
}

const TYPE_BAR: Record<WorkoutType, string> = {
  endurance: 'bg-blue-500',
  threshold: 'bg-red-500',
  intervals: 'bg-orange-500',
  recovery:  'bg-emerald-500',
  test:      'bg-violet-500',
}

const STATUS_CHIPS = {
  planned:      'bg-gray-100 text-gray-500 border border-gray-200',
  completed:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  skipped:      'bg-red-50 text-red-600 border border-red-200',
  needs_review: 'bg-amber-50 text-amber-700 border border-amber-200',
}

const STATUS_LABELS = {
  planned:      'Planned',
  completed:    '✓ Completed',
  skipped:      'Skipped',
  needs_review: 'Needs review',
}

interface Props {
  workout: Workout
  onClick?: () => void
  ftp?: number
  weather?: import('@/types').ActivityWeather | null
}

const WIND_ARROWS_CARD = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'] as const
function cardWindArrow(deg: number): string {
  return WIND_ARROWS_CARD[Math.round(((deg + 180) % 360) / 45) % 8]
}

export default function WorkoutCard({ workout, onClick, ftp, weather }: Props) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md hover:border-gray-300' : ''
      }`}
    >
      <div className={`h-1 ${TYPE_BAR[workout.type]}`} />
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize ${TYPE_CHIPS[workout.type]}`}>
            {workout.type}
          </span>
          <span className="text-sm font-medium text-gray-500">{workout.duration_minutes} min</span>
          {(() => {
            if (workout.status === 'completed' && workout.tss !== null) {
              const if_ = IF_BY_TYPE[workout.type] ?? 0.68
              const planned = Math.round((workout.duration_minutes * 60 * if_ * if_) / 36)
              return <span className="text-xs text-gray-400">· ~{planned} → {workout.tss} TSS</span>
            }
            const t = getTss(workout)
            return t ? (
              <span className="text-xs text-gray-400">· {t.estimated ? '~' : ''}{t.value} TSS</span>
            ) : null
          })()}
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${STATUS_CHIPS[workout.status]}`}>
          {STATUS_LABELS[workout.status]}
        </span>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-gray-700 leading-snug mb-1">{workout.description}</p>
        <p className="text-xs text-gray-400 font-medium">{deriveTargetZones(workout.steps, ftp) ?? workout.target_zones}</p>
        {workout.status === 'completed' && weather && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400 flex-wrap">
            <span>💨</span>
            <span>{weather.headwind_pct}% headwind</span>
            <span className="text-slate-300">·</span>
            <span>{Math.round(weather.temp_max_c)}°C</span>
            <span className="text-slate-300">·</span>
            <span className={
              Math.abs(weather.weather_impact_pct) < 1 ? 'text-slate-400'
              : weather.weather_impact_pct > 1 ? 'text-red-500'
              : 'text-emerald-600'
            }>
              {weather.weather_impact_pct > 0 ? '+' : ''}{weather.weather_impact_pct.toFixed(1)}%
            </span>
            <span className="text-slate-300">·</span>
            <span>{cardWindArrow(weather.wind_dir_deg)} {Math.round(weather.wind_avg_kph)} km/h</span>
          </div>
        )}
      </div>
    </div>
  )
}
