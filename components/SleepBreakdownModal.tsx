'use client'
import type { ICUWellness } from '@/types'

interface Props {
  wellness: ICUWellness
  onClose: () => void
}

type Band = 'high' | 'moderate' | 'low'

function bandFor(score: number): Band {
  if (score >= 75) return 'high'
  if (score >= 50) return 'moderate'
  return 'low'
}

const BAND_BG: Record<Band, string> = {
  high: 'bg-emerald-500', moderate: 'bg-amber-500', low: 'bg-red-500',
}

export default function SleepBreakdownModal({ wellness, onClose }: Props) {
  const score = wellness.sleep_score
  const band = score != null ? bandFor(score) : null
  const deepSecs = wellness.garmin_sleep_deep_secs ?? null
  const lightSecs = wellness.garmin_sleep_light_secs ?? null
  const remSecs = wellness.garmin_sleep_rem_secs ?? null
  const awakeSecs = wellness.garmin_sleep_awake_secs ?? null
  const hasStages = deepSecs != null || lightSecs != null || remSecs != null || awakeSecs != null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white w-full max-w-sm rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 pb-5 pt-5">
          <div className="mb-4">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-1">
              Sleep Breakdown
            </p>
            {score != null ? (
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-gray-900">{score}</span>
                <span className="text-sm text-gray-400">/ 100</span>
                {band && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white capitalize ${BAND_BG[band]}`}>
                    {band}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-300">Not synced</p>
            )}
          </div>

          {wellness.sleep_secs != null && (
            <p className="text-sm text-gray-700 mb-3">
              Duration <span className="text-gray-400">{(wellness.sleep_secs / 3600).toFixed(1)}h</span>
            </p>
          )}

          {hasStages && (
            <div className="space-y-2 pl-1">
              {deepSecs != null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-violet-400" />
                  <span className="text-xs text-gray-700">Deep <span className="text-gray-400">{Math.round(deepSecs / 60)}m</span></span>
                </div>
              )}
              {remSecs != null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-indigo-400" />
                  <span className="text-xs text-gray-700">REM <span className="text-gray-400">{Math.round(remSecs / 60)}m</span></span>
                </div>
              )}
              {lightSecs != null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-violet-200" />
                  <span className="text-xs text-gray-700">Light <span className="text-gray-400">{Math.round(lightSecs / 60)}m</span></span>
                </div>
              )}
              {awakeSecs != null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-gray-300" />
                  <span className="text-xs text-gray-700">Awake <span className="text-gray-400">{Math.round(awakeSecs / 60)}m</span></span>
                </div>
              )}
            </div>
          )}

          {score == null && wellness.sleep_secs == null && !hasStages && (
            <p className="text-xs text-gray-300">No sleep data synced for today</p>
          )}

          <div className="flex justify-end mt-5">
            <button
              onClick={onClose}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors min-h-[44px] px-2"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
