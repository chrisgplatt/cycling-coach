'use client'
import { useState } from 'react'

interface Props {
  onStart: (weeks: number) => void
  onCancel: () => void
}

export default function PlanDurationModal({ onStart, onCancel }: Props) {
  const [weeks, setWeeks] = useState(6)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">How many weeks should I plan?</h2>
          <p className="text-sm text-slate-500 mt-1">Claude will generate a training block of this length, starting today.</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={2}
            max={16}
            step={1}
            value={weeks}
            onChange={e => setWeeks(Math.min(16, Math.max(2, Number(e.target.value))))}
            className="w-24 text-center text-xl font-bold border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <span className="text-slate-600 font-medium">weeks</span>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onStart(weeks)}
            className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  )
}
