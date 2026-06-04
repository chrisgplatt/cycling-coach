'use client'
import { useState } from 'react'
import type {
  Workout, ProposedAdjustment, SessionFeedback, FeedbackCompletion, FeedbackTag,
} from '@/types'

type Phase = 'input' | 'proposed' | 'saved'

interface Props {
  workout: Workout
  onClose: () => void
  initialFeedback?: SessionFeedback
}

const FEEL_FACES = ['😀', '🙂', '😐', '😣', '😵']         // index 0..4 → feel 1..5 (fresh→flat)
const MOOD_FACES = ['😍', '🙂', '😐', '😞']               // index 0..3 → mood 1..4 (best→worst)
const COMPLETIONS: { value: FeedbackCompletion; label: string }[] = [
  { value: 'as_planned', label: 'to plan' },
  { value: 'cut_short', label: 'cut short' },
  { value: 'went_harder', label: 'went harder' },
  { value: 'modified', label: 'modified' },
]
const TAGS: { value: FeedbackTag; label: string }[] = [
  { value: 'niggle', label: 'niggle' },
  { value: 'illness', label: 'illness' },
  { value: 'poor_sleep', label: 'poor sleep' },
  { value: 'mechanical', label: 'mechanical' },
  { value: 'weather', label: 'weather' },
  { value: 'fuelling', label: 'fuelling' },
]

export default function FeedbackModal({ workout, onClose, initialFeedback }: Props) {
  const [phase, setPhase] = useState<Phase>(() => {
    if (!initialFeedback) return 'input'
    if (initialFeedback.proposed_adjustment && initialFeedback.approved === null) return 'proposed'
    return 'input'
  })
  const [feedbackText, setFeedbackText] = useState(initialFeedback?.feedback_text ?? '')
  const [rpe, setRpe] = useState<number | null>(initialFeedback?.rpe ?? null)
  const [feel, setFeel] = useState<number | null>(initialFeedback?.feel ?? null)
  const [completion, setCompletion] = useState<FeedbackCompletion | null>(initialFeedback?.completion ?? null)
  const [tags, setTags] = useState<FeedbackTag[]>(initialFeedback?.tags ?? [])
  const [mood, setMood] = useState<number | null>(initialFeedback?.mood ?? null)
  const [proposed, setProposed] = useState<{ feedbackId: string; adjustment: ProposedAdjustment } | null>(
    initialFeedback?.proposed_adjustment && initialFeedback.approved === null
      ? { feedbackId: initialFeedback.id, adjustment: initialFeedback.proposed_adjustment }
      : null
  )
  const [adapt, setAdapt] = useState(
    initialFeedback ? initialFeedback.proposed_adjustment !== null : false
  )
  const [loading, setLoading] = useState(false)

  const hasSignal =
    rpe != null || feel != null || completion != null || tags.length > 0 || mood != null || feedbackText.trim() !== ''

  function toggleTag(t: FeedbackTag) {
    setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  async function submitFeedback() {
    if (!hasSignal) return
    setLoading(true)
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workoutId: workout.id,
        activityId: workout.icu_activity_id ?? 'manual',
        feedbackText,
        adapt,
        rpe, feel, completion, tags, mood,
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

  const segBtn = 'px-3 py-2.5 rounded-lg text-sm border transition-colors'
  const segOn = 'bg-blue-600 text-white border-blue-600'
  const segOff = 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'

  const structuredInputs = (
    <div className="space-y-4">
      {/* RPE */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Effort (RPE)</p>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              type="button"
              aria-label={`RPE ${n}`}
              aria-pressed={rpe === n}
              onClick={() => setRpe(rpe === n ? null : n)}
              className={`py-3 rounded-lg text-sm border transition-colors ${rpe === n ? segOn : segOff}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Legs / body feel */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Legs / body</p>
        <div className="flex gap-2">
          {FEEL_FACES.map((face, i) => {
            const value = i + 1
            return (
              <button
                key={value}
                type="button"
                aria-label={`Feel ${value}`}
                aria-pressed={feel === value}
                onClick={() => setFeel(feel === value ? null : value)}
                className={`flex-1 py-2.5 rounded-lg text-xl border transition-colors ${feel === value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                {face}
              </button>
            )
          })}
        </div>
      </div>

      {/* Completion */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Went</p>
        <div className="flex flex-wrap gap-1.5">
          {COMPLETIONS.map(c => (
            <button
              key={c.value}
              type="button"
              aria-label={c.label}
              aria-pressed={completion === c.value}
              onClick={() => setCompletion(completion === c.value ? null : c.value)}
              className={`${segBtn} ${completion === c.value ? segOn : segOff}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Flags */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Flags</p>
        <div className="flex flex-wrap gap-1.5">
          {TAGS.map(t => (
            <button
              key={t.value}
              type="button"
              aria-label={t.label}
              aria-pressed={tags.includes(t.value)}
              onClick={() => toggleTag(t.value)}
              className={`${segBtn} ${tags.includes(t.value) ? segOn : segOff}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mood */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Mood</p>
        <div className="flex gap-2">
          {MOOD_FACES.map((face, i) => {
            const value = i + 1
            return (
              <button
                key={value}
                type="button"
                aria-label={`Mood ${value}`}
                aria-pressed={mood === value}
                onClick={() => setMood(mood === value ? null : value)}
                className={`flex-1 py-2.5 rounded-lg text-xl border transition-colors ${mood === value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                {face}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

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
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full max-w-md p-6 space-y-4 max-h-[92vh] overflow-y-auto">
        <h2 className="font-semibold text-gray-800">Session Feedback</h2>
        <p className="text-sm text-gray-500">
          {workout.date} — {workout.type} {workout.duration_minutes}min
        </p>

        {phase === 'input' && (
          <>
            {structuredInputs}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">Notes</p>
              <textarea
                value={feedbackText}
                onChange={e => setFeedbackText(e.target.value)}
                placeholder="Anything else? (optional)"
                rows={3}
                className="w-full text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {adaptToggle}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2.5">
                Cancel
              </button>
              <button
                onClick={submitFeedback}
                disabled={loading || !hasSignal}
                className="bg-blue-600 text-white text-sm px-4 py-2.5 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Saving…' : 'Save feedback'}
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
              <button onClick={() => approveAdjustment(false)} className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2.5">
                Reject
              </button>
              <button onClick={() => approveAdjustment(true)} className="bg-blue-600 text-white text-sm px-4 py-2.5 rounded hover:bg-blue-700">
                Approve Changes
              </button>
            </div>
          </>
        )}

        {phase === 'saved' && (
          <>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm text-gray-700 space-y-1.5">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
                {rpe != null && <span>RPE {rpe}/10</span>}
                {feel != null && <span>Legs {FEEL_FACES[feel - 1]}</span>}
                {completion && <span>{COMPLETIONS.find(c => c.value === completion)?.label}</span>}
                {tags.length > 0 && <span>{tags.map(t => TAGS.find(x => x.value === t)?.label).join(', ')}</span>}
                {mood != null && <span>{MOOD_FACES[mood - 1]}</span>}
              </div>
              {feedbackText.trim() && (
                <p className="whitespace-pre-wrap leading-relaxed">{feedbackText}</p>
              )}
            </div>
            <p className="text-xs text-green-600 font-medium">Feedback saved.</p>
            {adaptToggle}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2.5">
                Close
              </button>
              <button onClick={() => setPhase('input')} className="text-sm font-medium text-blue-600 hover:text-blue-700 px-2 py-2.5">
                Edit &amp; re-submit
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
