'use client'
import { useState } from 'react'
import type { Workout, ProposedAdjustment, SessionFeedback } from '@/types'

type Phase = 'input' | 'proposed' | 'saved'

interface Props {
  workout: Workout
  onClose: () => void
  initialFeedback?: SessionFeedback
}

export default function FeedbackModal({ workout, onClose, initialFeedback }: Props) {
  const [phase, setPhase] = useState<Phase>(() => {
    if (!initialFeedback) return 'input'
    if (initialFeedback.proposed_adjustment && initialFeedback.approved === null) return 'proposed'
    return 'input'  // edit mode: open straight to editable textarea
  })
  const [feedbackText, setFeedbackText] = useState(initialFeedback?.feedback_text ?? '')
  const [proposed, setProposed] = useState<{ feedbackId: string; adjustment: ProposedAdjustment } | null>(
    initialFeedback?.proposed_adjustment && initialFeedback.approved === null
      ? { feedbackId: initialFeedback.id, adjustment: initialFeedback.proposed_adjustment }
      : null
  )
  const [adapt, setAdapt] = useState(
    // New entries default to NOT suggesting adaptations; when editing existing
    // feedback, preserve whether that entry had an adaptation analysis.
    initialFeedback ? initialFeedback.proposed_adjustment !== null : false
  )
  const [loading, setLoading] = useState(false)

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
        adapt,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      if (adapt && data.proposed) {
        setProposed({ feedbackId: data.feedback.id, adjustment: data.proposed })
        setPhase('proposed')
      } else {
        setPhase('saved')
      }
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
      setProposed(null)
      setPhase('saved')
    }
  }

  const adaptToggle = (
    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={adapt}
        onChange={e => setAdapt(e.target.checked)}
        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      Suggest adaptations for upcoming workouts
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="font-semibold text-gray-800">Session Feedback</h2>
        <p className="text-sm text-gray-500">
          {workout.date} — {workout.type} {workout.duration_minutes}min
        </p>

        {phase === 'input' && (
          <>
            <textarea
              value={feedbackText}
              onChange={e => setFeedbackText(e.target.value)}
              placeholder="How did it feel? Any issues?"
              rows={4}
              className="w-full text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {adaptToggle}
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

        {phase === 'proposed' && proposed && (
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

        {phase === 'saved' && (
          <>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {feedbackText}
            </div>
            <p className="text-xs text-green-600 font-medium">Feedback saved.</p>
            {adaptToggle}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
                Close
              </button>
              <button
                onClick={() => setPhase('input')}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Edit &amp; re-submit
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
