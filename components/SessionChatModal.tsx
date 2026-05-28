'use client'
import { useState, useRef, useEffect } from 'react'
import type { Workout, ICUWellness, SessionProposal, SessionWeekProposal } from '@/types'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  workout: Workout
  wellness: ICUWellness | null
  onClose: () => void
  onWorkoutUpdated: (updated: Workout) => void
}

function buildOpeningMessage(workout: Workout, wellness: ICUWellness | null): string {
  const tsb = wellness?.form ?? (
    wellness?.ctl != null && wellness?.atl != null ? wellness.ctl - wellness.atl : null
  )
  let readiness = ''
  if (tsb != null) {
    if (tsb > 0) readiness = ` Feeling fresh (+${Math.round(tsb)} TSB).`
    else if (tsb >= -30) readiness = ` Moderate fatigue (${Math.round(tsb)} TSB).`
    else readiness = ` Heavy legs (${Math.round(tsb)} TSB) — worth discussing.`
  }
  const today = new Date().toISOString().split('T')[0]
  const whenStr = workout.date === today ? 'today' : `on ${workout.date}`
  return `You've got a ${workout.duration_minutes}min ${workout.type} session ${whenStr}.${readiness} What's on your mind?`
}

const PROPOSAL_MARKER = '__PROPOSAL__'
const WEEK_MARKER = '__WEEK_PROPOSAL__'
const REMEMBER_MARKER = '__REMEMBER__'
const FORGET_MARKER = '__FORGET__'

function extractNoteMarker(text: string): { visible: string; note?: string; forget?: string } {
  for (const [marker, key] of [
    [REMEMBER_MARKER, 'note'],
    [FORGET_MARKER, 'forget'],
  ] as [string, string][]) {
    const idx = text.indexOf(marker)
    if (idx !== -1) {
      try {
        const parsed = JSON.parse(text.slice(idx + marker.length).trim()) as { note?: string }
        if (parsed.note) return { visible: text.slice(0, idx).trim(), [key]: parsed.note }
      } catch { /* malformed — strip it */ }
      return { visible: text.slice(0, idx).trim() }
    }
  }
  return { visible: text }
}

function postNote(note?: string, forget?: string): void {
  if (!note && !forget) return
  fetch('/api/dossier/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note ? { note } : { forget }),
  }).catch(() => {})
}

export default function SessionChatModal({ workout, wellness, onClose, onWorkoutUpdated }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: buildOpeningMessage(workout, wellness) },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [proposal, setProposal] = useState<SessionProposal | null>(null)
  const [weekProposal, setWeekProposal] = useState<SessionWeekProposal | null>(null)
  const [applying, setApplying] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, proposal, weekProposal])

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return
    setInput('')
    // Capture history before adding new user message (stale closure is intentional —
    // history must NOT include the message being sent now, which is passed separately)
    const history = messages.slice(1)
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    const res = await fetch('/api/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, workoutId: workout.id, wellness, history }),
    })

    if (!res.body) { setLoading(false); return }
    if (!res.ok) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong — try again.' }])
      setLoading(false)
      return
    }

    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fullText += decoder.decode(value)
      const cutIdx = Math.min(
        fullText.includes(PROPOSAL_MARKER) ? fullText.indexOf(PROPOSAL_MARKER) : Infinity,
        fullText.includes(WEEK_MARKER) ? fullText.indexOf(WEEK_MARKER) : Infinity,
        fullText.includes(REMEMBER_MARKER) ? fullText.indexOf(REMEMBER_MARKER) : Infinity,
        fullText.includes(FORGET_MARKER) ? fullText.indexOf(FORGET_MARKER) : Infinity,
      )
      const visibleText = cutIdx < Infinity ? fullText.slice(0, cutIdx) : fullText
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: visibleText }
        return updated
      })
    }

    // Parse proposal blocks from the full buffered response
    const proposalIdx = fullText.indexOf(PROPOSAL_MARKER)
    const weekIdx = fullText.indexOf(WEEK_MARKER)

    if (proposalIdx !== -1) {
      try {
        setProposal(JSON.parse(fullText.slice(proposalIdx + PROPOSAL_MARKER.length).trim()) as SessionProposal)
      } catch { /* malformed — ignore */ }
    } else if (weekIdx !== -1) {
      try {
        setWeekProposal(JSON.parse(fullText.slice(weekIdx + WEEK_MARKER.length).trim()) as SessionWeekProposal)
      } catch { /* malformed — ignore */ }
    }

    // Handle note markers (mutually exclusive with proposals)
    if (fullText.indexOf(PROPOSAL_MARKER) === -1 && fullText.indexOf(WEEK_MARKER) === -1) {
      const { visible, note, forget } = extractNoteMarker(fullText)
      if (note || forget) {
        postNote(note, forget)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: visible }
          return updated
        })
      }
    }

    setLoading(false)
  }

  async function handleApprove() {
    if (!proposal || applying) return
    setApplying(true)
    try {
      const res = await fetch(`/api/workouts/${workout.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proposal.today_update),
      })
      if (res.ok) {
        onWorkoutUpdated({ ...workout, ...proposal.today_update })
        const followUp = proposal.week_follow_up
        setProposal(null)
        setMessages(prev => [...prev, { role: 'assistant', content: 'Done — session updated.' }])
        if (followUp) {
          setTimeout(() => setMessages(prev => [...prev, { role: 'assistant', content: followUp }]), 400)
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: "Something went wrong — the session could not be updated. Try again." }])
      }
    } finally {
      setApplying(false)
    }
  }

  function handleReject() {
    setProposal(null)
    setMessages(prev => [...prev, { role: 'assistant', content: "No problem — let me know if you'd like to try a different approach." }])
  }

  async function handleWeekApprove() {
    if (!weekProposal || applying) return
    setApplying(true)
    try {
      const allowedFields = new Set(['duration_minutes', 'description', 'type', 'target_zones'])
      const safeChanges = weekProposal.changes.filter(c => allowedFields.has(c.field))
      const results = await Promise.all(
        safeChanges.map(c =>
          fetch(`/api/workouts/${c.workout_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [c.field]: c.new_value }),
          })
        )
      )
      const failed = results.filter(r => !r.ok)
      setWeekProposal(null)
      if (failed.length > 0) {
        setMessages(prev => [...prev, { role: 'assistant', content: `${results.length - failed.length} of ${results.length} changes applied. Some updates failed — try again.` }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: "Week adjusted. You're all set." }])
      }
    } finally {
      setApplying(false)
    }
  }

  function handleWeekReject() {
    setWeekProposal(null)
    setMessages(prev => [...prev, { role: 'assistant', content: 'Understood — keeping the rest of the week as planned.' }])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl flex flex-col w-full max-w-lg max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-blue-600" aria-hidden="true">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
              </svg>
              Coach Chat
            </p>
            <p className="text-sm font-semibold text-slate-800 capitalize">
              {workout.duration_minutes}min {workout.type}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-sm font-medium py-1 px-2 min-h-[44px] flex items-center"
          >
            Close
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : ''}`}>
              <span className={`inline-block rounded-xl px-3 py-2 max-w-[85%] text-sm leading-snug ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-100 text-slate-800 rounded-bl-sm'
              }`}>
                {m.content}
              </span>
            </div>
          ))}

          {/* Today proposal card */}
          {proposal && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Proposed changes</p>
              {proposal.today_update.duration_minutes !== undefined && (
                <p className="text-sm">
                  <span className="text-slate-500">Duration: </span>
                  <span className="font-medium">{workout.duration_minutes}min → {proposal.today_update.duration_minutes}min</span>
                </p>
              )}
              {proposal.today_update.type !== undefined && (
                <p className="text-sm">
                  <span className="text-slate-500">Type: </span>
                  <span className="font-medium capitalize">{workout.type} → {proposal.today_update.type}</span>
                </p>
              )}
              {proposal.today_update.description !== undefined && (
                <p className="text-xs text-slate-600 italic leading-relaxed">{proposal.today_update.description}</p>
              )}
              <p className="text-xs text-slate-500">{proposal.rationale}</p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={handleReject}
                  disabled={applying}
                  className="text-sm text-slate-500 hover:text-slate-700 font-medium px-3 py-2 min-h-[44px]"
                >
                  Reject
                </button>
                <button
                  onClick={handleApprove}
                  disabled={applying}
                  className="text-sm bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
                >
                  {applying ? 'Applying…' : 'Approve'}
                </button>
              </div>
            </div>
          )}

          {/* Week proposal card */}
          {weekProposal && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Week adjustments</p>
              {weekProposal.changes.map((c, i) => (
                <div key={i} className="space-y-0.5">
                  <p className="text-sm">
                    <span className="font-medium capitalize">{String(c.field).replaceAll('_', ' ')}: </span>
                    <span className="text-slate-500">{String(c.old_value)} → {String(c.new_value)}</span>
                  </p>
                  <p className="text-xs text-slate-500">{c.reason}</p>
                </div>
              ))}
              <p className="text-xs text-slate-500 pt-1">{weekProposal.rationale}</p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={handleWeekReject}
                  disabled={applying}
                  className="text-sm text-slate-500 hover:text-slate-700 font-medium px-3 py-2 min-h-[44px]"
                >
                  Reject
                </button>
                <button
                  onClick={handleWeekApprove}
                  disabled={applying}
                  className="text-sm bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
                >
                  {applying ? 'Applying…' : 'Approve all'}
                </button>
              </div>
            </div>
          )}

          {loading && <p className="text-xs text-slate-400 pl-1">Coach is typing…</p>}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="p-3 border-t border-slate-100 flex gap-2 items-center shrink-0">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && sendMessage()}
            placeholder="Ask your coach…"
            className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-full px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            className="w-11 h-11 bg-blue-600 text-white rounded-full flex items-center justify-center hover:bg-blue-700 disabled:opacity-50 shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
