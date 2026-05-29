'use client'
import { useState } from 'react'

interface Props {
  onStart: (weeks: number, startDate: string, notes: string) => void
  onCancel: () => void
  initialNotes?: string
}

function timeEstimate(weeks: number): string {
  if (weeks <= 4) return '1–2 minutes'
  if (weeks <= 8) return '2–3 minutes'
  return '3–4 minutes'
}

const WEEK_OPTIONS = Array.from({ length: 13 }, (_, i) => i + 1)

export default function PlanDurationModal({ onStart, onCancel, initialNotes }: Props) {
  const [weeks, setWeeks] = useState(6)
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState(initialNotes ?? '')

  function handleStart() {
    onStart(weeks, startDate, notes.trim())
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Build a new plan</h2>
          <p className="text-sm text-slate-500 mt-1">Claude will generate a periodized training block.</p>
        </div>
        <div className="overflow-hidden">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="w-full min-w-0 text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Duration</label>
          <select
            value={weeks}
            onChange={e => setWeeks(Number(e.target.value))}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {WEEK_OPTIONS.map(n => (
              <option key={n} value={n}>{n} {n === 1 ? 'week' : 'weeks'}</option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-2">Generation will take {timeEstimate(weeks)}.</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Anything else to consider?</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. I have a niggling knee injury, prefer longer weekend rides, just returned from a week off…"
            rows={3}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  )
}
