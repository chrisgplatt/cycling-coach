import type { Workout, WorkoutType } from '@/types'
import { deriveTargetZones } from '@/lib/claude/zones'
import { WORKOUT_TYPE_CHIP, WORKOUT_STATUS_CHIP, WORKOUT_STATUS_LABEL } from '@/lib/workout-colours'
import { estimateTss } from '@/lib/estimate-tss'

function getTss(workout: Workout): { value: number; estimated: boolean } | null {
  if (workout.tss !== null) return { value: workout.tss, estimated: false }
  if (workout.status === 'planned') {
    return { value: estimateTss(workout.type, workout.duration_minutes), estimated: true }
  }
  return null
}

const TYPE_BAR: Record<WorkoutType, string> = {
  endurance: 'bg-blue-500',
  threshold: 'bg-red-500',
  intervals: 'bg-orange-500',
  recovery:  'bg-emerald-500',
  test:      'bg-violet-500',
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
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize ${WORKOUT_TYPE_CHIP[workout.type]}`}>
            {workout.type}
          </span>
          <span className="text-sm font-medium text-gray-500">
            {workout.status === 'completed' && workout.actual_duration_minutes !== null
              ? <>{workout.duration_minutes} → {workout.actual_duration_minutes} min</>
              : <>{workout.duration_minutes} min</>}
          </span>
          {(() => {
            if (workout.status === 'completed' && workout.tss !== null) {
              const planned = estimateTss(workout.type, workout.duration_minutes)
              return <span className="text-xs text-gray-400">· ~{planned} → {workout.tss} TSS</span>
            }
            const t = getTss(workout)
            return t ? (
              <span className="text-xs text-gray-400">· {t.estimated ? '~' : ''}{t.value} TSS</span>
            ) : null
          })()}
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${WORKOUT_STATUS_CHIP[workout.status]}`}>
          {WORKOUT_STATUS_LABEL[workout.status]}
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
