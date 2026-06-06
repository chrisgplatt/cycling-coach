'use client'
import { useEffect, useRef, useState } from 'react'

interface Props {
  feedbackId: string
  coachNote: string | null
}

type Msg = { role: 'user' | 'assistant'; content: string }

// Inline, expandable two-way thread anchored to a logged feedback entry. The coach's
// note (session_feedback.coach_note) is the opening assistant turn; replies stream from
// /api/feedback/chat and persist to feedback_messages.
export default function FeedbackChat({ feedbackId, coachNote }: Props) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/feedback/chat?feedbackId=${feedbackId}`)
      .then(r => (r.ok ? r.json() : { messages: [] }))
      .then(d => { if (active) setMessages((d.messages ?? []) as Msg[]) })
      .catch(() => { /* empty thread is fine */ })
    return () => { active = false }
  }, [feedbackId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    const history = messages
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    const res = await fetch('/api/feedback/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackId, message: text, history }),
    })

    if (!res.ok || !res.body) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong — try again.' }])
      setLoading(false)
      return
    }

    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let full = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      full += decoder.decode(value)
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: full }
        return updated
      })
    }
    setLoading(false)
  }

  const bubble = (role: 'user' | 'assistant', content: string, key: string | number) => (
    <div key={key} className={role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ' +
          (role === 'user'
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-slate-100 text-slate-700 rounded-bl-sm')
        }
      >
        {content || '…'}
      </div>
    </div>
  )

  return (
    <div className="mt-2 space-y-2">
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {coachNote && bubble('assistant', coachNote, 'note')}
        {messages.map((m, i) => bubble(m.role, m.content, i))}
        <div ref={endRef} />
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
          placeholder="Reply to your coach…"
          rows={1}
          className="flex-1 resize-none text-sm border border-slate-300 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          className="bg-blue-600 text-white text-sm px-4 py-2.5 rounded-xl hover:bg-blue-700 disabled:opacity-50 shrink-0"
        >
          {loading ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
