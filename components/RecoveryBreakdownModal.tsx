'use client'
import { COMPONENT_WEIGHTS, type RecoveryScore, type ComponentKey } from '@/lib/recovery-score'

interface Props {
  recovery: RecoveryScore
  onClose: () => void
}

const BAND_BG: Record<RecoveryScore['band'], string> = {
  high: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  low: 'bg-red-500',
}

function barColour(value: number): string {
  if (value >= 75) return 'bg-emerald-500'
  if (value >= 50) return 'bg-amber-500'
  return 'bg-red-500'
}

const COMPONENT_META: { key: ComponentKey; label: string; detail: string }[] = [
  { key: 'sleep', label: 'Sleep', detail: 'Duration + deep/REM stages vs an 8h target' },
  { key: 'hrv', label: 'HRV', detail: "Today's HRV vs your rolling baseline" },
  { key: 'wellness', label: 'Wellness', detail: 'Logged energy + leg freshness' },
  { key: 'tsb', label: 'Training load', detail: "Today's form (TSB)" },
  { key: 'bodyBattery', label: 'Body battery', detail: 'Peak Garmin body battery' },
]

export default function RecoveryBreakdownModal({ recovery, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white w-full max-w-sm rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 pb-5 pt-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-1">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-1">
                Recovery Breakdown
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-gray-900">{recovery.score}</span>
                <span className="text-sm text-gray-400">/ 100</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white capitalize ${BAND_BG[recovery.band]}`}>
                  {recovery.band}
                </span>
              </div>
            </div>
          </div>
          {recovery.explanation && (
            <p className="text-xs text-gray-500 mb-4">{recovery.explanation}</p>
          )}
          {!recovery.explanation && <div className="mb-4" />}

          {/* Component rows */}
          <div className="space-y-4">
            {COMPONENT_META.map(({ key, label, detail }) => {
              const value = recovery.components[key]
              const weightPct = Math.round(COMPONENT_WEIGHTS[key] * 100)
              return (
                <div key={key}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-sm font-semibold text-gray-800">
                      {label}
                      <span className="text-[11px] font-normal text-gray-400 ml-1.5">{weightPct}% weight</span>
                    </span>
                    <span className="text-sm font-bold text-gray-700">
                      {value != null ? Math.round(value) : <span className="text-xs font-normal text-gray-300">Not available</span>}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full mb-1">
                    {value != null && (
                      <div
                        className={`h-full rounded-full transition-all ${barColour(value)}`}
                        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                      />
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">{detail}</p>
                </div>
              )
            })}
          </div>

          <p className="text-[11px] text-gray-400 mt-4">
            Unavailable components are excluded, and the remaining weights are scaled up proportionally.
          </p>

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
