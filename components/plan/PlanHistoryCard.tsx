'use client'
import { useState } from 'react'
import type { PlanArchiveSummary } from '@/types'

interface HistoryPlan {
  id: string
  name: string
  target_event_name: string
  target_event_date: string
  closed_at: string | null
  archive_summary: PlanArchiveSummary | null
}

interface Props {
  plan: HistoryPlan
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-bold text-slate-900">{value}</div>
    </div>
  )
}

export default function PlanHistoryCard({ plan }: Props) {
  const [expanded, setExpanded] = useState(false)
  const s = plan.archive_summary

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left p-4 space-y-2 min-h-[44px]"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-slate-900">{plan.name}</p>
          {s?.closedEarly && (
            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
              Closed early
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          {plan.target_event_name}
          {s && ` · ${fmtDate(s.startDate)} – ${fmtDate(s.plannedEndDate)}`}
          {s?.closedEarly && ` (closed ${fmtDate(s.closedAt)})`}
        </p>
        {s && (
          <div className="grid grid-cols-4 gap-2 pt-1">
            <Stat label="Sessions" value={`${s.totalCompletedSessions}/${s.totalPlannedSessions}`} />
            <Stat label="Hours" value={s.totalHours.toFixed(1)} />
            <Stat label="TSS" value={String(s.totalTss)} />
            <Stat
              label="Fitness"
              value={s.fitnessChange != null ? `CTL ${s.fitnessChange >= 0 ? '+' : ''}${s.fitnessChange}` : '—'}
            />
          </div>
        )}
      </button>
      {expanded && s && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left font-semibold px-4 py-2">Week</th>
                <th className="text-right font-semibold px-2 py-2">Rides</th>
                <th className="text-right font-semibold px-2 py-2">Hours</th>
                <th className="text-right font-semibold px-2 py-2">TSS</th>
              </tr>
            </thead>
            <tbody>
              {s.weeks.map(w => (
                <tr key={w.weekIndex} className="border-t border-slate-50">
                  <td className="px-4 py-2 text-slate-700">Wk {w.weekIndex + 1} · {fmtDate(w.weekStart)}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{w.completedSessions}/{w.plannedSessions}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{w.hours.toFixed(1)}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{w.actualTss}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
