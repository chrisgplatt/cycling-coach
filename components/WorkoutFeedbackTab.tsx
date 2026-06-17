'use client'
import { useState, useEffect, useRef } from 'react'
import type {
  SessionFeedback, ProposedAdjustment, FeedbackCompletion, FeedbackTag, CoachNoteRating,
} from '@/types'
import CoachNotePanel from './CoachNotePanel'

type Phase = 'input' | 'proposed' | 'saved'

interface Props {
  workoutId: string
  existingFeedback: SessionFeedback | null | 'loading'
  onFeedbackSaved: () => void
}

const FEEL_FACES = ['😀', '🙂', '😐', '😣', '😵']
const MOOD_FACES = ['😍', '🙂', '😐', '😞']
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

function derivePhase(f: SessionFeedback | null | 'loading'): Phase {
  if (!f || f === 'loading') return 'input'
  if (f.proposed_adjustment && f.approved === null) return 'proposed'
  return 'saved'
}

export default function WorkoutFeedbackTab({ workoutId, existingFeedback, onFeedbackSaved }: Props) {
  const [phase, setPhase] = useState<Phase>('input')
  const [feedbackText, setFeedbackText] = useState('')
  const [rpe, setRpe] = useState<number | null>(null)
  const [feel, setFeel] = useState<number | null>(null)
  const [completion, setCompletion] = useState<FeedbackCompletion | null>(null)
  const [tags, setTags] = useState<FeedbackTag[]>([])
  const [mood, setMood] = useState<number | null>(null)
  const [adapt, setAdapt] = useState(false)
  const [proposed, setProposed] = useState<{ feedbackId: string; adjustment: ProposedAdjustment } | null>(null)
  const [coachNote, setCoachNote] = useState<string | null>(null)
  const [savedFeedbackId, setSavedFeedbackId] = useState<string | null>(null)
  const [coachNoteRating] = useState<CoachNoteRating | null>(null)
  const [loading, setLoading] = useState(false)
  const initialised = useRef(false)

  // Sync state once when existingFeedback resolves from 'loading' to a real value (or null).
  // The initialised ref prevents overwriting in-progress edits on re-renders.
  useEffect(() => {
    if (existingFeedback === 'loading' || initialised.current) return
    initialised.current = true
    if (!existingFeedback) return
    setPhase(derivePhase(existingFeedback))
    setFeedbackText(existingFeedback.feedback_text ?? '')
    setRpe(existingFeedback.rpe ?? null)
    setFeel(existingFeedback.feel ?? null)
    setCompletion(existingFeedback.completion ?? null)
    setTags(existingFeedback.tags ?? [])
    setMood(existingFeedback.mood ?? null)
    setAdapt(existingFeedback.proposed_adjustment !== null)
    if (existingFeedback.proposed_adjustment && existingFeedback.approved === null) {
      setProposed({ feedbackId: existingFeedback.id, adjustment: existingFeedback.proposed_adjustment })
    }
    setCoachNote(existingFeedback.coach_note ?? null)
    setSavedFeedbackId(existingFeedback.id)
  }, [existingFeedback])

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
        workoutId,
        activityId: 'manual',
        feedbackText,
        adapt,
        rpe, feel, completion, tags, mood,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      setCoachNote(data.feedback?.coach_note ?? null)
      setSavedFeedbackId(data.feedback?.id ?? null)
      if (adapt && data.proposed) {
        setProposed({ feedbackId: data.feedback.id, adjustment: data.proposed })
        setPhase('proposed')
      } else {
        setPhase('saved')
        onFeedbackSaved()
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
      onFeedbackSaved()
    }
  }

  if (existingFeedback === 'loading') {
    return <p className="text-sm text-slate-400">Loading…</p>
  }

  const segBtn = 'px-3 py-2.5 rounded-lg text-sm border transition-colors'
  const segOn = 'bg-blue-600 text-white border-blue-600'
  const segOff = 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'

  if (phase === 'input') {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Effort (RPE)</p>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <button key={n} type="button" aria-label={`RPE ${n}`} aria-pressed={rpe === n}
                onClick={() => setRpe(rpe === n ? null : n)}
                className={`py-3 rounded-lg text-sm border transition-colors ${rpe === n ? segOn : segOff}`}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Legs / body</p>
          <div className="flex gap-2">
            {FEEL_FACES.map((face, i) => {
              const value = i + 1
              return (
                <button key={value} type="button" aria-label={`Feel ${value}`} aria-pressed={feel === value}
                  onClick={() => setFeel(feel === value ? null : value)}
                  className={`flex-1 py-2.5 rounded-lg text-xl border transition-colors ${feel === value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  {face}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Went</p>
          <div className="flex flex-wrap gap-1.5">
            {COMPLETIONS.map(c => (
              <button key={c.value} type="button" aria-label={c.label} aria-pressed={completion === c.value}
                onClick={() => setCompletion(completion === c.value ? null : c.value)}
                className={`${segBtn} ${completion === c.value ? segOn : segOff}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Flags</p>
          <div className="flex flex-wrap gap-1.5">
            {TAGS.map(t => (
              <button key={t.value} type="button" aria-label={t.label} aria-pressed={tags.includes(t.value)}
                onClick={() => toggleTag(t.value)}
                className={`${segBtn} ${tags.includes(t.value) ? segOn : segOff}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Mood</p>
          <div className="flex gap-2">
            {MOOD_FACES.map((face, i) => {
              const value = i + 1
              return (
                <button key={value} type="button" aria-label={`Mood ${value}`} aria-pressed={mood === value}
                  onClick={() => setMood(mood === value ? null : value)}
                  className={`flex-1 py-2.5 rounded-lg text-xl border transition-colors ${mood === value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  {face}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Notes</p>
          <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
            placeholder="Anything else? (optional)" rows={3}
            className="w-full text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={adapt} onChange={e => setAdapt(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          Suggest adaptations for upcoming workouts
        </label>
        <div className="flex justify-end">
          <button onClick={submitFeedback} disabled={loading || !hasSignal}
            className="bg-blue-600 text-white text-sm px-4 py-2.5 rounded hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Saving…' : 'Save feedback'}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'proposed' && proposed) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-gray-700 bg-yellow-50 border border-yellow-200 rounded p-3">
          <p className="font-medium mb-2">Proposed adjustments:</p>
          <p>{proposed.adjustment.summary}</p>
          {proposed.adjustment.changes.map((c, i) => (
            <div key={i} className="mt-2 text-xs text-gray-600">
              &bull; {c.field}: {String(c.old_value)} &rarr; {String(c.new_value)} ({c.reason})
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => approveAdjustment(false)}
            className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2.5">
            Reject
          </button>
          <button onClick={() => approveAdjustment(true)}
            className="bg-blue-600 text-white text-sm px-4 py-2.5 rounded hover:bg-blue-700">
            Approve Changes
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
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
      {coachNote && savedFeedbackId && (
        <CoachNotePanel feedbackId={savedFeedbackId} coachNote={coachNote} initialRating={coachNoteRating} />
      )}
      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
        <input type="checkbox" checked={adapt} onChange={e => setAdapt(e.target.checked)}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        Suggest adaptations for upcoming workouts
      </label>
      <div className="flex justify-end">
        <button onClick={() => setPhase('input')}
          className="text-sm font-medium text-blue-600 hover:text-blue-700 px-2 py-2.5">
          Edit &amp; re-submit
        </button>
      </div>
    </div>
  )
}
