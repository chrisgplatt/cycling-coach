'use client'
import { computeStrainComponents, strainLabel, STRAIN_WORKOUT_WEIGHT, STRAIN_LIFE_WEIGHT } from '@/lib/strain'
import type { ICUWellness } from '@/types'
import type { HrvStatus } from '@/lib/hrv/baseline'

interface Props {
  wellness: ICUWellness
  activitySummary?: string
  hrvStatus?: HrvStatus | null
  todayDailyWellness?: { energy: number | null; leg_freshness: number | null } | null
  onClose: () => void
}

const BAND_BG: Record<string, string> = {
  low: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  high: 'bg-red-500',
}

export default function StrainBreakdownSheet({ wellness, activitySummary, hrvStatus, todayDailyWellness, onClose }: Props) {
  const batteryCharged = wellness.garmin_body_battery_charged ?? null
  const batteryDrained = wellness.garmin_body_battery_drained ?? null
  const batteryDrainFallback = (wellness.garmin_body_battery_current != null && wellness.body_battery_high != null)
    ? Math.max(0, wellness.body_battery_high - wellness.garmin_body_battery_current)
    : null
  const drainForScore = batteryDrained ?? batteryDrainFallback

  const c = computeStrainComponents(wellness.garmin_training_load, {
    sleepScore: wellness.sleep_score,
    bodyBatteryHigh: wellness.body_battery_high,
    sleepSecs: wellness.sleep_secs,
    hrv: hrvStatus?.today ?? null,
    hrvBaseline: hrvStatus?.baselineMean ?? null,
    energy: todayDailyWellness?.energy ?? null,
    legFreshness: todayDailyWellness?.leg_freshness ?? null,
    batteryDrained: drainForScore,
  })
  if (!c) return null

  const totalStrain = c.total
  const label = strainLabel(totalStrain)

  const trainingReadiness = wellness.garmin_training_readiness ?? null
  const recoveryTimeMins = wellness.garmin_recovery_time_mins ?? null

  const deepSecs = wellness.garmin_sleep_deep_secs ?? null
  const lightSecs = wellness.garmin_sleep_light_secs ?? null
  const remSecs = wellness.garmin_sleep_rem_secs ?? null
  const awakeSecs = wellness.garmin_sleep_awake_secs ?? null

  const d = 21
  const w  = (c.workoutPts          / d) * 100
  const sl = (c.sleepRawPts         / d) * 100
  const hr = (c.hrvRawPts           / d) * 100
  const sd = (c.sleepDurationRawPts / d) * 100
  const wl = (c.wellnessRawPts      / d) * 100
  const b  = (c.batteryRawPts       / d) * 100
  const dr = (c.drainRawPts         / d) * 100
  const seg1 = w
  const seg2 = seg1 + sl
  const seg3 = seg2 + hr
  const seg4 = seg3 + sd
  const seg5 = seg4 + wl
  const seg6 = seg5 + b
  const seg7 = Math.min(100, seg6 + dr)
  const donut = `conic-gradient(#3b82f6 0% ${seg1}%, #8b5cf6 ${seg1}% ${seg2}%, #6366f1 ${seg2}% ${seg3}%, #a78bfa ${seg3}% ${seg4}%, #14b8a6 ${seg4}% ${seg5}%, #10b981 ${seg5}% ${seg6}%, #f97316 ${seg6}% ${seg7}%, #e2e8f0 ${seg7}% 100%)`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" />
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
              {/* HRV */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.hrv != null && c.hrvBaseline != null ? 'bg-indigo-400' : 'bg-gray-200'}`} />
                {c.hrv != null && c.hrvBaseline != null ? (
                  <span className="text-xs text-gray-700">
                    HRV <span className="text-gray-400">{Math.round(c.hrv)}ms (baseline {Math.round(c.hrvBaseline)}ms)</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">HRV <em>not synced</em></span>
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
              {/* Sleep stages (Garmin) */}
              {deepSecs != null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-violet-200" />
                  <span className="text-xs text-gray-700">
                    Sleep stages{' '}
                    <span className="text-gray-400">
                      {Math.round(deepSecs / 60)}m deep
                      {remSecs != null && ` · ${Math.round(remSecs / 60)}m REM`}
                      {lightSecs != null && ` · ${Math.round(lightSecs / 60)}m light`}
                      {awakeSecs != null && ` · ${Math.round(awakeSecs / 60)}m awake`}
                    </span>
                  </span>
                </div>
              )}
              {/* Subjective wellness */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.energy != null || c.legFreshness != null ? 'bg-teal-400' : 'bg-gray-200'}`} />
                {c.energy != null || c.legFreshness != null ? (
                  <span className="text-xs text-gray-700">
                    Subjective wellness <span className="text-gray-400">
                      {c.energy != null && `Energy ${c.energy}/5`}
                      {c.energy != null && c.legFreshness != null && ' · '}
                      {c.legFreshness != null && `Legs ${c.legFreshness}/5`}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Subjective wellness <em>not synced</em></span>
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
