'use client'
import { useState } from 'react'

interface Props {
  onStart: (weeks: number, startDate: string) => void
  onCancel: () => void
}

export default function PlanDurationModal({ onStart, onCancel }: Props) {
  const [weeksStr, setWeeksStr] = useState('6')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])

  function handleStart() {
    const w = Math.min(16, Math.max(2, Math.round(Number(weeksStr) || 6)))
    onStart(w, startDate)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Build a new plan</h2>
          <p className="text-sm text-slate-500 mt-1">Claude will generate a periodized training block.</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Duration</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={2}
              max={16}
              step={1}
              value={weeksStr}
              onChange={e => setWeeksStr(e.target.value)}
              onBlur={e => {
                const clamped = Math.min(16, Math.max(2, Math.round(Number(e.target.value) || 6)))
                setWeeksStr(String(clamped))
              }}
              className="w-24 text-center text-xl font-bold border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <span className="text-slate-600 font-medium">weeks</span>
          </div>
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
