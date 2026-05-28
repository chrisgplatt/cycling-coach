'use client'
import { useState, useRef, useEffect } from 'react'
import type { ICUSyncData } from '@/types'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  currentFTP: number
  syncData: ICUSyncData | null
}

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

export default function ChatPanel({ currentFTP, syncData }: Props) {
  const [open, setOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hi! I'm your cycling coach. How can I help you today?" },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 1024px)')
    setIsDesktop(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (
      bottomRef.current &&
      typeof bottomRef.current.scrollIntoView === 'function'
    ) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  async function sendMessage() {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMsg, syncData, currentFTP }),
    })

    if (!res.body) { setLoading(false); return }

    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: updated[updated.length - 1].content + chunk,
        }
        return updated
      })
    }
    // Strip any note markers and fire the notes API
    setMessages(prev => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last.role === 'assistant') {
        const { visible, note, forget } = extractNoteMarker(last.content)
        postNote(note, forget)
        updated[updated.length - 1] = { ...last, content: visible }
      }
      return updated
    })
    setLoading(false)
  }

  const panel = (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Coach Chat</span>
        {!isDesktop && (
          <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xs font-medium">
            Close
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : ''}`}>
            <span className={`inline-block rounded-xl px-3 py-2 max-w-[85%] text-sm leading-snug ${
              m.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-gray-100 text-gray-800 rounded-bl-sm'
            }`}>
              {m.content}
            </span>
          </div>
        ))}
        {loading && (
          <div className="text-xs text-gray-400 pl-1">Coach is typing…</div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="p-3 border-t border-gray-200 flex gap-2 items-center">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Ask your coach…"
          className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          onClick={sendMessage}
          disabled={loading}
          className="w-9 h-9 bg-blue-600 text-white rounded-full flex items-center justify-center hover:bg-blue-700 disabled:opacity-50 shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
          </svg>
        </button>
      </div>
    </div>
  )

  // Desktop: always show sidebar
  if (isDesktop) {
    return (
      <div className="w-80 shrink-0 h-screen sticky top-0">
        {panel}
      </div>
    )
  }

  // Mobile: floating button or full-screen panel
  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col">{panel}</div>
      ) : (
        <button
          aria-label="Chat with coach"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 bg-blue-600 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg text-sm font-medium hover:bg-blue-700"
        >
          Chat
        </button>
      )}
    </>
  )
}
