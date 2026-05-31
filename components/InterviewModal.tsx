'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import type { ICUWellness } from '@/types'
import { INTERVIEW_COMPLETE_MARKER, parseInterviewCompletion } from '@/lib/claude/interview'
import { useVoiceInput } from '@/lib/hooks/useVoiceInput'

interface Message { role: 'user' | 'assistant'; content: string }

interface Props {
  wellness: ICUWellness | null
  currentFTP: number
  onComplete: (brief: string) => void
  onClose: () => void
}

function persistNotes(notes: string[]) {
  for (const note of notes) {
    fetch('/api/dossier/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }).catch(() => {})
  }
}

export default function InterviewModal({ wellness, currentFTP, onComplete, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const startedRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const voice = useVoiceInput()

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = useCallback(async (text: string, opts: { display: boolean }) => {
    if (loading) return
    setLoading(true)
    const history = messages
    if (opts.display) setMessages(prev => [...prev, { role: 'user', content: text }])

    let res: Response
    try {
      res = await fetch('/api/chat/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, wellness, history, currentFTP }),
      })
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong — try again.' }])
      setLoading(false)
      return
    }
    if (!res.ok || !res.body) {
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
      const cut = fullText.includes(INTERVIEW_COMPLETE_MARKER)
        ? fullText.indexOf(INTERVIEW_COMPLETE_MARKER)
        : Infinity
      const visible = cut < Infinity ? fullText.slice(0, cut).trim() : fullText
      setMessages(prev => {
        const u = [...prev]
        u[u.length - 1] = { role: 'assistant', content: visible }
        return u
      })
    }

    const parsed = parseInterviewCompletion(fullText)
    if (fullText.includes(INTERVIEW_COMPLETE_MARKER)) {
      if (parsed.dossier_notes?.length) persistNotes(parsed.dossier_notes)
      setLoading(false)
      onComplete(parsed.plan_brief ?? '')
      return
    }
    setLoading(false)
  }, [loading, messages, wellness, currentFTP, onComplete])

  // Fire the opening (seed) turn once on mount.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void send('', { display: false })
  }, [send])

  function handleSend() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    if (voice.listening) voice.stop()
    void send(text, { display: true })
  }

  function finishNow() {
    if (loading) return
    if (voice.listening) voice.stop()
    void send("That's everything — please build my plan.", { display: true })
  }

  function toggleMic() {
    if (voice.listening) { voice.stop(); return }
    voice.start(text => setInput(text))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl flex flex-col w-full max-w-lg max-h-[92vh] sm:max-h-[85vh]">

        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-blue-600" aria-hidden="true">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
              </svg>
              Coach Interview
            </p>
            <p className="text-sm font-semibold text-slate-800">Tailoring your plan</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-sm font-medium py-1 px-2 min-h-[44px] flex items-center"
          >
            Close
          </button>
        </div>

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
          {loading && <p className="text-xs text-slate-400 pl-1">Coach is preparing…</p>}
          <div ref={bottomRef} />
        </div>

        <div className="px-3 pt-2 shrink-0">
          <button
            onClick={finishNow}
            disabled={loading || messages.length === 0}
            className="text-xs font-medium text-slate-400 hover:text-slate-600 disabled:opacity-40 min-h-[44px]"
          >
            Finish &amp; build my plan →
          </button>
        </div>

        <div className="p-3 border-t border-slate-100 flex gap-2 items-center shrink-0">
          {voice.supported && (
            <button
              onClick={toggleMic}
              disabled={loading}
              aria-label={voice.listening ? 'Stop dictation' : 'Start dictation'}
              className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 disabled:opacity-50 ${
                voice.listening ? 'bg-red-600 text-white animate-pulse' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
              </svg>
            </button>
          )}
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder={voice.listening ? 'Listening…' : 'Type or tap the mic…'}
            className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-full px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleSend}
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
