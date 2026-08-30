'use client'
import { useEffect, useState } from 'react'
import type { TrainingSummary } from '@/lib/plan/summary'

const RANGE_OPTIONS: Array<{ label: string; months: 6 | 12 }> = [
  { label: '6mo', months: 6 },
  { label: '12mo', months: 12 },
]

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function fmtDelta(value: number | null, unit: string): string {
  if (value == null) return 'Not available'
  return `${value >= 0 ? '+' : ''}${value}${unit}`
}

export default function PlanSummaryRollup() {
  const [months, setMonths] = useState<6 | 12>(12)
  const [summary, setSummary] = useState<TrainingSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSummary(null)
    setError(null)
    fetch(`/api/plan/summary?months=${months}`)
      .then(res => { if (!res.ok) throw new Error('Failed to fetch training summary'); return res.json() })
      .then(data => { if (!cancelled) setSummary(data) })
      .catch(() => { if (!cancelled) setError("Couldn't load your training summary.") })
    return () => { cancelled = true }
  }, [months])

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Training summary</h3>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.months}
              onClick={() => setMonths(opt.months)}
              className={`text-[11px] font-semibold px-2 py-1.5 rounded min-h-[44px] ${
                months === opt.months ? 'bg-blue-50 text-blue-700' : 'text-slate-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && !summary && (
        <div className="h-20 bg-slate-100 rounded-lg animate-pulse" data-testid="plan-summary-skeleton" />
      )}
      {!error && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Tile label="Rides" value={String(summary.ridesCompleted)} />
          <Tile label="Hours" value={summary.hoursTrained.toFixed(1)} />
          <Tile label="Weeks trained" value={`${summary.weeksWithPlan}/${summary.weeksInWindow}`} />
          <Tile label="Fitness" value={fmtDelta(summary.fitnessChange, '')} />
          <Tile
            label="FTP"
            value={fmtDelta(summary.ftpChange, 'W')}
            sub={summary.ftpStartIsPartial ? 'since your first recorded FTP' : undefined}
          />
        </div>
      )}
    </div>
  )
}
