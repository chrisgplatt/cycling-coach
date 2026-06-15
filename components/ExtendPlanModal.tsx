'use client'
import { useState } from 'react'
import { computeMethodology } from '@/lib/claude/methodology'
import type { TrainingEvent, TrainingPhilosophy } from '@/types'

interface Props {
  planEndDate: string
  planCreatedAt: string
  planWeeks: number
  currentPhilosophy: TrainingPhilosophy | null
  weeklyHours: number
  nearestEvent: TrainingEvent | null
  currentCTL: number | null
  onConfirm: (extraWeeks: number) => void
  onClose: () => void
}

const WEEK_CHIPS = [2, 4, 6, 8]

export default function ExtendPlanModal({
  planEndDate,
  planCreatedAt,
  planWeeks,
  currentPhilosophy,
  weeklyHours,
  nearestEvent,
  currentCTL,
  onConfirm,
  onClose,
}: Props) {
  const today = new Date().toISOString().split('T')[0]

  const isEventMode = nearestEvent !== null && nearestEvent.date > planEndDate

  const suggestedWeeks = nearestEvent
    ? Math.max(1, Math.ceil(
        (new Date(nearestEvent.date).getTime() - new Date(planEndDate).getTime()) / (7 * 86400000)
      ))
    : 2

  const [selectedWeeks, setSelectedWeeks] = useState(isEventMode ? suggestedWeeks : 2)

  const weeksCompleted = Math.max(0, Math.floor(
    (new Date(today).getTime() - new Date(planCreatedAt.split('T')[0]).getTime()) / (7 * 86400000)
  ))
  const remainingWeeks = Math.max(1, planWeeks - weeksCompleted)
  const newTotal = weeksCompleted + remainingWeeks + selectedWeeks

  const updatedPhilosophy = computeMethodology({
    weeklyHours,
    weeksToEvent: newTotal,
    eventType: nearestEvent?.type ?? null,
    eventPriority: nearestEvent?.priority ?? null,
    currentCTL,
    goals: '',
  })

  const pw = updatedPhilosophy.phase_weeks
  const phases = [
    { key: 'Base', weeks: pw.base, colour: '#0ea5e9' },
    { key: 'Build', weeks: pw.build, colour: '#6366f1' },
    { key: 'Peak', weeks: pw.peak, colour: '#8b5cf6' },
    { key: 'Taper', weeks: pw.taper, colour: '#64748b' },
  ].filter(p => p.weeks > 0)

  const newEndDate = isEventMode
    ? nearestEvent!.date
    : (() => {
        const d = new Date(planEndDate)
        d.setUTCDate(d.getUTCDate() + selectedWeeks * 7)
        return d.toISOString().split('T')[0]
      })()

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[92vh] overflow-y-auto">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Extend plan</p>
          <p className="text-lg font-extrabold text-slate-900">
            {isEventMode ? `${nearestEvent!.name} moved` : 'How many weeks?'}
          </p>
          <p className="text-sm text-slate-500 mt-0.5">
            {isEventMode
              ? `Your event is now ${suggestedWeeks} week${suggestedWeeks === 1 ? '' : 's'} beyond your plan end.`
              : `Currently ends ${fmtDate(planEndDate)} · Week ${planWeeks} of ${planWeeks}`}
          </p>
        </div>

        {isEventMode ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1">Current end</p>
              <p className="text-sm font-bold text-slate-600">{fmtDate(planEndDate)}</p>
              <p className="text-[10px] text-slate-400">Week {planWeeks}</p>
            </div>
            <div className="bg-blue-50 border-2 border-blue-300 rounded-xl px-3 py-2.5">
              <p className="text-[9px] font-bold text-blue-500 uppercase tracking-wide mb-1">New end</p>
              <p className="text-sm font-bold text-blue-700">{fmtDate(newEndDate)}</p>
              <p className="text-[10px] text-blue-500">Week {planWeeks + suggestedWeeks} (+{suggestedWeeks})</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {WEEK_CHIPS.map(w => (
              <button
                key={w}
                onClick={() => setSelectedWeeks(w)}
                className={`rounded-xl py-3 text-center transition-colors ${
                  selectedWeeks === w
                    ? 'bg-blue-50 border-2 border-blue-500'
                    : 'bg-slate-50 border border-slate-200'
                }`}
              >
                <p className={`text-base font-extrabold ${selectedWeeks === w ? 'text-blue-700' : 'text-slate-600'}`}>+{w}</p>
                <p className={`text-[9px] font-semibold ${selectedWeeks === w ? 'text-blue-500' : 'text-slate-400'}`}>weeks</p>
              </button>
            ))}
          </div>
        )}

        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
          <p className="text-xs text-green-800">{updatedPhilosophy.rationale}</p>
        </div>

        <div>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-2">Updated structure</p>
          <div className="flex rounded-lg overflow-hidden h-5">
            {phases.map(p => (
              <div
                key={p.key}
                style={{ background: p.colour, flex: p.weeks }}
                className="flex items-center justify-center"
              >
                <span className="text-[8px] font-bold text-white truncate px-1">{p.key} {p.weeks}w</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <button
            onClick={() => onConfirm(selectedWeeks)}
            className="w-full bg-blue-600 text-white text-sm font-bold rounded-xl py-3 hover:bg-blue-700 transition-colors min-h-[44px]"
          >
            {isEventMode ? `Extend to ${fmtDate(newEndDate)}` : `Extend plan by ${selectedWeeks} week${selectedWeeks === 1 ? '' : 's'}`}
          </button>
          <button
            onClick={onClose}
            className="w-full text-slate-400 text-sm py-2 min-h-[44px]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
