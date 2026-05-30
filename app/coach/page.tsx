'use client'
import { useEffect, useState } from 'react'
import CoachChat from '@/components/CoachChat'
import type { AthleteDossier } from '@/lib/claude/dossier'

function ageLabel(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 864e5)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function Prose({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mb-1">{label}</p>
      <p className="text-sm text-gray-700 leading-relaxed">{value}</p>
    </div>
  )
}

function Chips({ label, values }: { label: string; values?: string[] }) {
  if (!values?.length) return null
  return (
    <div>
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span key={i} className="text-xs bg-blue-50 text-blue-700 rounded-full px-2.5 py-1">{v}</span>
        ))}
      </div>
    </div>
  )
}

export default function CoachPage() {
  const [dossier, setDossier] = useState<AthleteDossier | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [ftp, setFtp] = useState(200)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)

  async function loadDossier() {
    const res = await fetch('/api/dossier')
    const data = await res.json().catch(() => ({ dossier: null }))
    setDossier(data.dossier ?? null)
    setLoaded(true)
  }

  useEffect(() => {
    loadDossier().catch(() => setLoaded(true))
    fetch('/api/profile')
      .then(r => r.json())
      .then(p => setFtp(p.current_ftp ?? 200))
      .catch(() => {})
  }, [])

  async function refresh() {
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/dossier/refresh', { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Refresh failed')
      } else {
        await loadDossier()
      }
    } catch {
      setError('Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  async function removeNote(note: string) {
    await fetch('/api/dossier/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forget: note }),
    }).catch(() => {})
    loadDossier().catch(() => {})
  }

  const content = dossier?.content
  const hasContent = !!content && Object.values(content).some(v => Array.isArray(v) ? v.length : !!v)
  const notes = [...(dossier?.explicit_notes ?? [])].reverse()

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Coach&apos;s notes</h1>
          {dossier?.synthesized_at && (
            <p className="text-xs text-gray-400">Updated {ageLabel(dossier.synthesized_at)}</p>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 py-2.5 px-3 rounded-lg hover:bg-blue-50 transition-colors"
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {!loaded ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !hasContent ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
          <p className="text-sm text-gray-500">No coach&apos;s notes yet.</p>
          <p className="text-sm text-gray-400 mt-1">Chat with your coach or hit Refresh to build your profile.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
          <Prose label="As a rider" value={content?.as_rider} />
          <Chips label="Strengths" values={content?.strengths} />
          <Chips label="Watch" values={content?.weaknesses} />
          <Prose label="Training compliance" value={content?.training_compliance} />
          <Prose label="Recovery profile" value={content?.recovery_profile} />
          <Prose label="Event performance" value={content?.event_performance} />
          <Prose label="Trajectory" value={content?.trajectory} />
        </div>
      )}

      {notes.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mb-2.5">Remember</p>
          <ul className="space-y-2">
            {notes.map((n, i) => (
              <li key={i} className="flex items-start justify-between gap-3 text-sm text-gray-700">
                <span className="leading-relaxed">{n.note}</span>
                <button
                  onClick={() => removeNote(n.note)}
                  aria-label="Remove note"
                  className="text-gray-300 hover:text-red-500 shrink-0 w-8 h-8 flex items-center justify-center -mt-1"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={() => setChatOpen(true)}
        className="w-full bg-blue-600 text-white text-sm font-semibold rounded-xl py-3.5 hover:bg-blue-700 transition-colors shadow-sm"
      >
        💬 Chat with your coach
      </button>

      {chatOpen && <CoachChat currentFTP={ftp} onClose={() => setChatOpen(false)} />}
    </div>
  )
}
