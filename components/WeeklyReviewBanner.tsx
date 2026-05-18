'use client'
import { useState } from 'react'

interface Props {
  lastWeekCompleted: number
  lastWeekTotal: number
  onReview: (note: string) => void
  onDismiss: () => void
}

export default function WeeklyReviewBanner({ lastWeekCompleted, lastWeekTotal, onReview, onDismiss }: Props) {
  const [note, setNote] = useState('')

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-blue-900">Weekly plan review</p>
        <p className="text-sm text-blue-700 mt-0.5">
          {lastWeekTotal > 0
            ? `${lastWeekCompleted} of ${lastWeekTotal} workouts completed last week`
            : 'No workouts were scheduled last week'}
        </p>
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Anything to tell your coach? (injuries, fatigue, life events…)"
        rows={2}
        className="w-full text-sm border border-blue-200 bg-white rounded-lg px-3 py-2 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onReview(note)}
          className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Review & Adapt Plan
        </button>
        <button
          onClick={onDismiss}
          className="text-sm text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-100 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
