'use client'
import { useState, useRef, useEffect } from 'react'
import type { ICUWellness, ProposedAdjustment, NewWorkoutProposal, Workout } from '@/types'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  planName: string
  targetEvent: string
  targetDate: string
  futureWorkouts: Workout[]
  wellness: ICUWellness | null
  currentFTP: number
  onClose: () => void
  onWorkoutsUpdated: () => void
}

const PLAN_MARKER = '__PLAN_PROPOSAL__'
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

export default function PlanChatModal({
  planName, targetEvent, targetDate, futureWorkouts, wellness, currentFTP, onClose, onWorkoutsUpdated,
}: Props) {
  const openingMsg = futureWorkouts.length
    ? `You're on the ${planName} plan with ${futureWorkouts.length} session${futureWorkouts.length === 1 ? '' : 's'} ahead, building toward ${targetEvent} on ${targetDate}. What would you like to discuss or change?`
    : `You're on the ${planName} plan, targeting ${targetEvent} on ${targetDate}. No future sessions are scheduled yet. What's on your mind?`

  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: openingMsg },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [proposal, setProposal] = useState<ProposedAdjustment | null>(null)
  const [applying, setApplying] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, proposal])

  // Build a lookup of workout id → workout for display in the proposal card
  const workoutById = Object.fromEntries(futureWorkouts.map(w => [w.id, w]))

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return
    setInput('')
    const history = messages.slice(1)
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    const res = await fetch('/api/chat/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, wellness, history, currentFTP }),
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
        fullText.includes(PLAN_MARKER) ? fullText.indexOf(PLAN_MARKER) : Infinity,
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

    const markerIdx = fullText.indexOf(PLAN_MARKER)
    if (markerIdx !== -1) {
      try {
        setProposal(JSON.parse(fullText.slice(markerIdx + PLAN_MARKER.length).trim()) as ProposedAdjustment)
      } catch (e) {
        console.error('Failed to parse plan proposal JSON:', e)
        setMessages(prev => [...prev, { role: 'assistant', content: 'I outlined some changes but had trouble formatting the proposal. Could you ask me again?' }])
      }
    }

    // Handle note markers (mutually exclusive with plan proposals)
    if (fullText.indexOf(PLAN_MARKER) === -1) {
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

    // Group changes by workout_id so we send one PATCH per workout
    const byWorkout = new Map<string, Record<string, unknown>>()
    const allowedFields = new Set(['duration_minutes', 'description', 'type', 'target_zones'])
    for (const c of proposal.changes) {
      if (!allowedFields.has(c.field)) continue
      const patch = byWorkout.get(c.workout_id) ?? {}
      patch[c.field] = c.new_value
      byWorkout.set(c.workout_id, patch)
    }
    // Merge workout_steps into the same patch body
    for (const ws of proposal.workout_steps ?? []) {
      const patch = byWorkout.get(ws.workout_id) ?? {}
      patch.steps = ws.steps
      byWorkout.set(ws.workout_id, patch)
    }

    try {
      const patchResults = await Promise.all(
        [...byWorkout.entries()].map(([id, body]) =>
          fetch(`/api/workouts/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        )
      )

      const postResults = await Promise.all(
        (proposal.new_workouts ?? []).map((nw: NewWorkoutProposal) =>
          fetch('/api/workouts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nw),
          })
        )
      )

      const allResults = [...patchResults, ...postResults]
      const failed = allResults.filter(r => !r.ok)
      setProposal(null)
      if (failed.length > 0) {
        setMessages(prev => [...prev, { role: 'assistant', content: `${allResults.length - failed.length} of ${allResults.length} changes applied. Some updates failed — try again.` }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Done — plan updated. Intervals.icu is synced.' }])
        onWorkoutsUpdated()
      }
    } finally {
      setApplying(false)
    }
  }

  function handleReject() {
    setProposal(null)
    setMessages(prev => [...prev, { role: 'assistant', content: "No problem — keeping the plan as is. Let me know if you'd like to try something different." }])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
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
            <p className="text-sm font-semibold text-slate-800">{planName}</p>
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

          {/* Proposal card */}
          {proposal && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Proposed changes</p>
              <p className="text-xs text-slate-600">{proposal.summary}</p>
              {proposal.changes.map((c, i) => {
                const w = workoutById[c.workout_id]
                return (
                  <div key={i} className="bg-white border border-amber-100 rounded-lg px-3 py-2 space-y-0.5">
                    {w && (
                      <p className="text-xs font-semibold text-slate-500">{w.date} · {w.type}</p>
                    )}
                    <p className="text-sm">
                      <span className="font-medium capitalize">{String(c.field).replaceAll('_', ' ')}: </span>
                      <span className="text-slate-500">{String(c.old_value)} → {String(c.new_value)}</span>
                    </p>
                    <p className="text-xs text-slate-400">{c.reason}</p>
                  </div>
                )
              })}
              {(proposal.new_workouts ?? []).map((nw, i) => (
                <div key={`new-${i}`} className="bg-white border border-emerald-200 rounded-lg px-3 py-2 space-y-0.5">
                  <p className="text-xs font-semibold text-emerald-600">+ New session · {nw.date}</p>
                  <p className="text-sm font-medium capitalize text-slate-700">{nw.type} — {nw.duration_minutes}min</p>
                  <p className="text-xs text-slate-500 line-clamp-2">{nw.description}</p>
                  <p className="text-xs text-slate-400">{nw.reason}</p>
                </div>
              ))}
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
                  {applying ? 'Applying…' : (() => {
                    const total = proposal.changes.length + (proposal.new_workouts?.length ?? 0)
                    return `Approve ${total} change${total === 1 ? '' : 's'}`
                  })()}
                </button>
              </div>
            </div>
          )}

          {loading && <p className="text-xs text-slate-400 pl-1">Coach is typing…</p>}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-slate-100 flex gap-2 items-center shrink-0">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && sendMessage()}
            placeholder="Ask about your plan…"
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
