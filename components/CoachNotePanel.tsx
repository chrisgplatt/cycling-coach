'use client'
import { useState } from 'react'
import type { CoachNoteRating } from '@/types'
import FeedbackChat from './FeedbackChat'

interface Props {
  feedbackId: string
  coachNote: string | null
  initialRating: CoachNoteRating | null
}

// The coach's post-ride note, a usefulness rating, and an expandable conversation
// thread. Shared between the workout detail view and the feedback modal's saved phase.
export default function CoachNotePanel({ feedbackId, coachNote, initialRating }: Props) {
  const [rating, setRating] = useState<CoachNoteRating | null>(initialRating)
  const [showChat, setShowChat] = useState(false)

  if (!coachNote) return null

  function rate(next: CoachNoteRating) {
    const value = rating === next ? null : next   // tap again to clear
    setRating(value)
    fetch('/api/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackId, coachNoteRating: value }),
    }).catch(() => setRating(rating))   // revert on failure
  }

  const pill = (active: boolean) =>
    'px-2.5 py-1.5 rounded-lg text-sm border transition-colors ' +
    (active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400')

  return (
    <div className="border-l-2 border-blue-300 bg-blue-50/60 rounded-r-lg px-3 py-2 space-y-2">
      <p className="text-[11px] font-semibold text-blue-500 uppercase tracking-wide">Coach&apos;s take</p>
      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{coachNote}</p>

      <div className="flex items-center gap-2 pt-0.5">
        <span className="text-xs text-slate-400">Useful?</span>
        <button type="button" aria-label="Helpful" aria-pressed={rating === 'helpful'}
          onClick={() => rate('helpful')} className={pill(rating === 'helpful')}>👍</button>
        <button type="button" aria-label="Not helpful" aria-pressed={rating === 'not_helpful'}
          onClick={() => rate('not_helpful')} className={pill(rating === 'not_helpful')}>👎</button>
        <button type="button" onClick={() => setShowChat(v => !v)}
          className="ml-auto text-xs font-medium text-blue-600 hover:text-blue-700">
          {showChat ? 'Hide chat' : 'Discuss with coach'}
        </button>
      </div>

      {showChat && <FeedbackChat feedbackId={feedbackId} coachNote={coachNote} />}
    </div>
  )
}
