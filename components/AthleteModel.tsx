'use client'
import { useEffect, useState } from 'react'
import type { AthleteBelief } from '@/types'

const CONF_STYLE: Record<AthleteBelief['confidence'], string> = {
  high: 'bg-emerald-50 text-emerald-700',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-gray-100 text-gray-500',
}
const CONF_RANK: Record<AthleteBelief['confidence'], number> = { low: 0, medium: 1, high: 2 }

// Surface a belief once its confidence ≥ medium, or the athlete has already set it.
// Order: contradiction-flagged first (needs a decision), then lowest confidence
// (most worth confirming), then the settled high-confidence ones.
function visibleSorted(beliefs: AthleteBelief[]): AthleteBelief[] {
  return beliefs
    .filter(b => b.confidence !== 'low' || b.status === 'confirmed' || b.status === 'corrected')
    .sort((a, b) => {
      const ac = a.contradiction ? 1 : 0
      const bc = b.contradiction ? 1 : 0
      if (ac !== bc) return bc - ac
      return CONF_RANK[a.confidence] - CONF_RANK[b.confidence]
    })
}

export default function AthleteModel() {
  const [beliefs, setBeliefs] = useState<AthleteBelief[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const res = await fetch('/api/athlete-model')
    if (!res.ok) { setBeliefs([]); return }
    const d = await res.json().catch(() => ({ beliefs: [] }))
    setBeliefs((d.beliefs ?? []) as AthleteBelief[])
  }
  useEffect(() => { load().catch(() => setBeliefs([])) }, [])

  async function act(key: string, action: 'confirm' | 'correct' | 'dismiss', value_text?: string) {
    if (busy) return
    setBusy(true)
    setEditing(null)
    try {
      await fetch('/api/athlete-model', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, action, value_text }),
      })
      await load()
    } catch { /* best-effort; the card simply won't refresh */ }
    setBusy(false)
  }

  if (!beliefs) return null
  const shown = visibleSorted(beliefs)
  if (!shown.length) return null

  return (
    <div data-testid="athlete-model" className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-3">
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em]">What your coach has learned</p>
      <ul className="space-y-3">
        {shown.map(b => (
          <li key={b.key} className="border-b border-gray-100 last:border-0 pb-3 last:pb-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-800">{b.label}</span>
              <span aria-label={`${b.confidence} confidence`} className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${CONF_STYLE[b.confidence]}`}>{b.confidence}</span>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">{b.value_text}</p>
            <p className="text-xs text-gray-400">
              {b.evidence}{b.status === 'confirmed' ? ' · you confirmed this' : b.status === 'corrected' ? ' · your words' : ''}
            </p>
            {b.contradiction && (
              <p className="text-xs text-amber-600">New data suggests: {b.contradiction.observed} — keep yours or update?</p>
            )}
            {editing === b.key ? (
              <div className="space-y-2">
                <textarea
                  value={draft} onChange={e => setDraft(e.target.value)} rows={2}
                  className="w-full text-sm border border-gray-200 rounded-lg p-2"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditing(null)} className="text-sm text-gray-500 py-3 px-3">Cancel</button>
                  <button onClick={() => act(b.key, 'correct', draft)} disabled={busy || !draft.trim()}
                    className="text-sm font-medium text-blue-600 py-3 px-3 disabled:opacity-40">Save</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <button onClick={() => act(b.key, 'confirm')} disabled={busy}
                  className="text-sm font-medium text-emerald-700 bg-emerald-50 rounded-lg px-3 py-3">Confirm</button>
                <button onClick={() => { setEditing(b.key); setDraft(b.value_text) }}
                  className="text-sm font-medium text-blue-700 bg-blue-50 rounded-lg px-3 py-3">Correct</button>
                <button onClick={() => act(b.key, 'dismiss')} disabled={busy}
                  className="text-sm font-medium text-gray-500 bg-gray-100 rounded-lg px-3 py-3">Dismiss</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
