'use client'
import { computeActivityTrimpBreakdown, strainLabel } from '@/lib/strain'
import type { DailyStrainPoint } from '@/types'

interface ActivityInput {
  name: string
  durationMin: number
  avgHr: number | null
  trainingLoad: number | null
}

interface Props {
  strainToday: DailyStrainPoint
  activities: ActivityInput[]
  maxHr: number | null
  restingHr: number | null
  onClose: () => void
}

const BAND_BG: Record<string, string> = {
  light: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  high: 'bg-orange-500',
  all_out: 'bg-red-500',
}

const DONUT_COLORS = ['#3b82f6', '#8b5cf6', '#6366f1', '#a78bfa', '#14b8a6', '#10b981', '#f97316', '#f43f5e']

export default function StrainBreakdownSheet({ strainToday, activities, maxHr, restingHr, onClose }: Props) {
  const totalStrain = strainToday.workoutStrain
  const label = strainLabel(totalStrain)
  const breakdown = computeActivityTrimpBreakdown(activities, maxHr, restingHr)
  const totalTrimp = breakdown.reduce((s, a) => s + a.trimp, 0)

  let acc = 0
  const segments = breakdown.map((a, i) => {
    const pct = totalTrimp > 0 ? (a.trimp / totalTrimp) * 100 : 0
    const start = acc
    acc += pct
    return { ...a, pct, start, end: acc, color: DONUT_COLORS[i % DONUT_COLORS.length] }
  })
  const donut = segments.length > 0
    ? `conic-gradient(${segments.map(s => `${s.color} ${s.start}% ${s.end}%`).join(', ')}, #e2e8f0 ${acc}% 100%)`
    : 'conic-gradient(#e2e8f0 0% 100%)'

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
                  {label === 'all_out' ? 'All Out' : label.charAt(0).toUpperCase() + label.slice(1)}
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

          <p className="text-[11px] text-gray-400 mb-3">
            Today vs your own recent hard-day reference: {Math.round(strainToday.dailyTrimp)} / {Math.round(strainToday.trimpRef)} TRIMP
          </p>

          {/* Per-activity breakdown */}
          {segments.length > 0 ? (
            <div className="space-y-2.5 pl-1">
              {segments.map(s => (
                <div key={s.name} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-xs text-gray-700">
                    {s.name} <span className="text-gray-400">{Math.round(s.pct)}% of today&apos;s load</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-300">No activity recorded today</p>
          )}

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
