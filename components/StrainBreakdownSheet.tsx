'use client'
import { computeStrainComponents, strainLabel, STRAIN_WORKOUT_WEIGHT, STRAIN_LIFE_WEIGHT } from '@/lib/strain'
import type { ICUWellness } from '@/types'

interface Props {
  wellness: ICUWellness
  activitySummary?: string
  onClose: () => void
}

const BAND_BG: Record<string, string> = {
  low: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  high: 'bg-red-500',
}

export default function StrainBreakdownSheet({ wellness, activitySummary, onClose }: Props) {
  const c = computeStrainComponents(
    wellness.garmin_training_load,
    wellness.sleep_score,
    wellness.body_battery_high,
    wellness.sleep_secs,
  )
  if (!c) return null

  const totalStrain = c.total
  const label = strainLabel(totalStrain)

  const batteryCharged = wellness.garmin_body_battery_charged ?? null
  const batteryDrained = wellness.garmin_body_battery_drained ?? null
  const batteryDrainFallback = (wellness.garmin_body_battery_current != null && wellness.body_battery_high != null)
    ? Math.max(0, wellness.body_battery_high - wellness.garmin_body_battery_current)
    : null
  const trainingReadiness = wellness.garmin_training_readiness ?? null
  const recoveryTimeMins = wellness.garmin_recovery_time_mins ?? null

  const d = 21
  const w  = (c.workoutPts          / d) * 100
  const sl = (c.sleepRawPts         / d) * 100
  const sd = (c.sleepDurationRawPts / d) * 100
  const b  = (c.batteryRawPts       / d) * 100
  const drainForDonut = batteryDrained ?? batteryDrainFallback
  const dr = drainForDonut != null ? (Math.min(drainForDonut, 100) / 21) * 100 : 0
  const donut = `conic-gradient(#3b82f6 0% ${w}%, #8b5cf6 ${w}% ${w+sl}%, #a78bfa ${w+sl}% ${w+sl+sd}%, #10b981 ${w+sl+sd}% ${w+sl+sd+b}%, #f97316 ${w+sl+sd+b}% ${Math.min(100, w+sl+sd+b+dr)}%, #e2e8f0 ${Math.min(100, w+sl+sd+b+dr)}% 100%)`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        role="button"
        tabIndex={0}
        aria-label="Close"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose() }}
      />
      <div className="relative bg-white w-full max-w-sm rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 pb-5 pt-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-1">
                Strain Breakdown
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-gray-900">{totalStrain}</span>
                <span className="text-sm text-gray-400">/ 21</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white ${BAND_BG[label]}`}>
                  {label.charAt(0).toUpperCase() + label.slice(1)}
                </span>
              </div>
            </div>
            {/* Donut ring */}
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: donut }}
            >
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-base font-black text-gray-900">
                {totalStrain}
              </div>
            </div>
          </div>

          {/* Workout bar */}
          <div className="mb-4">
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-sm font-semibold text-gray-800">Workout load</span>
              <span className="text-sm font-bold text-blue-600">
                {(Math.round(c.workoutPts * 10) / 10).toFixed(1)}
                <span className="text-xs font-normal text-gray-400"> / {STRAIN_WORKOUT_WEIGHT} pts</span>
              </span>
            </div>
            <div className="h-2 bg-blue-50 rounded-full mb-1.5">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (c.workoutPts / STRAIN_WORKOUT_WEIGHT) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-400">
              {activitySummary ?? (c.workoutLoad > 0 ? `${Math.round(c.workoutLoad)} TSS` : 'no activity recorded')}
            </p>
          </div>

          <div className="border-t border-gray-100 mb-4" />

          {/* Wellbeing bar */}
          <div>
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-sm font-semibold text-gray-800">Wellbeing</span>
              <span className="text-sm font-bold text-amber-500">
                {(Math.round(c.lifePts * 10) / 10).toFixed(1)}
                <span className="text-xs font-normal text-gray-400"> / {STRAIN_LIFE_WEIGHT} pts</span>
              </span>
            </div>
            <div className="h-2 bg-amber-50 rounded-full mb-3">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (c.lifePts / STRAIN_LIFE_WEIGHT) * 100)}%`,
                  background: 'linear-gradient(90deg, #f59e0b, #fb923c)',
                }}
              />
            </div>

            {/* Sub-signal rows */}
            <div className="space-y-2.5 pl-1">
              {/* Sleep quality */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.sleepScore != null ? 'bg-violet-400' : 'bg-gray-200'}`} />
                {c.sleepScore != null ? (
                  <span className="text-xs text-gray-700">
                    Sleep quality <span className="text-gray-400">score {c.sleepScore} / 100</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Sleep quality <em>not synced</em></span>
                )}
              </div>
              {/* Sleep duration */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.sleepSecs != null ? 'bg-violet-300' : 'bg-gray-200'}`} />
                {c.sleepSecs != null ? (
                  <span className="text-xs text-gray-700">
                    Sleep duration <span className="text-gray-400">{(c.sleepSecs / 3600).toFixed(1)}h</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Sleep duration <em>not synced</em></span>
                )}
              </div>
              {/* Body battery peak */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.bodyBatteryHigh != null ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                {c.bodyBatteryHigh != null ? (
                  <span className="text-xs text-gray-700">
                    Body battery <span className="text-gray-400">peak {c.bodyBatteryHigh}%</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Body battery <em>not synced</em></span>
                )}
              </div>
              {/* Battery charged / drained */}
              {batteryCharged != null || batteryDrained != null ? (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-orange-400" />
                  <span className="text-xs text-gray-700">
                    Body battery{' '}
                    <span className="text-gray-400">
                      {batteryCharged != null && `↑${batteryCharged} charged`}
                      {batteryCharged != null && batteryDrained != null && ' / '}
                      {batteryDrained != null && `↓${batteryDrained} drained`}
                    </span>
                  </span>
                </div>
              ) : batteryDrainFallback != null ? (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-orange-400" />
                  <span className="text-xs text-gray-700">
                    Battery drain <span className="text-gray-400">
                      {batteryDrainFallback}% today ({wellness.body_battery_high}% → {wellness.garmin_body_battery_current}%)
                    </span>
                  </span>
                </div>
              ) : null}
              {/* Training readiness + recovery time */}
              {trainingReadiness != null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-sky-400" />
                  <span className="text-xs text-gray-700">
                    Training readiness <span className="text-gray-400">{trainingReadiness} / 100</span>
                    {recoveryTimeMins != null && (
                      <span className="text-gray-400"> · full recovery in {(recoveryTimeMins / 60).toFixed(1)}h</span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end mt-5">
            <button
              onClick={onClose}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
