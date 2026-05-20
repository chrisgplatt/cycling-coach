'use client'
import { useState } from 'react'
import type { Workout, ProposedAdjustment } from '@/types'

interface Props {
  workout: Workout
  onClose: () => void
}

export default function FeedbackModal({ workout, onClose }: Props) {
  const [feedbackText, setFeedbackText] = useState('')
  const [loading, setLoading] = useState(false)
  const [proposed, setProposed] = useState<{ feedbackId: string; adjustment: ProposedAdjustment } | null>(null)
  const [done, setDone] = useState(false)

  async function submitFeedback() {
    if (!feedbackText.trim()) return
    setLoading(true)
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workoutId: workout.id,
        activityId: workout.icu_activity_id ?? 'manual',
        feedbackText,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      setProposed({ feedbackId: data.feedback.id, adjustment: data.proposed })
    }
    setLoading(false)
  }

  async function approveAdjustment(approve: boolean) {
    if (!proposed) return
    const res = await fetch('/api/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackId: proposed.feedbackId, approved: approve }),
    })
    if (res.ok) {
      setDone(true)
      setTimeout(onClose, 1000)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="font-semibold text-gray-800">Session Feedback</h2>
        <p className="text-sm text-gray-500">
          {workout.date} — {workout.type} {workout.duration_minutes}min
        </p>

        {!proposed && !done && (
          <>
            <textarea
              value={feedbackText}
              onChange={e => setFeedbackText(e.target.value)}
              placeholder="How did it feel? Any issues?"
              rows={4}
              className="w-full text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
              <button
                onClick={submitFeedback}
                disabled={loading || !feedbackText.trim()}
                className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Analysing…' : 'Submit'}
              </button>
            </div>
          </>
        )}

        {proposed && !done && (
          <>
            <div className="text-sm text-gray-700 bg-yellow-50 border border-yellow-200 rounded p-3">
              <p className="font-medium mb-2">Proposed adjustments:</p>
              <p>{proposed.adjustment.summary}</p>
              {proposed.adjustment.changes.map((c, i) => (
                <div key={i} className="mt-2 text-xs text-gray-600">
                  • {c.field}: {String(c.old_value)} → {String(c.new_value)} ({c.reason})
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => approveAdjustment(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Reject
              </button>
              <button
                onClick={() => approveAdjustment(true)}
                className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700"
              >
                Approve Changes
              </button>
            </div>
          </>
        )}

        {done && (
          <p className="text-sm text-green-600 font-medium">Changes applied!</p>
        )}
      </div>
    </div>
  )
}
