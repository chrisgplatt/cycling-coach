'use client'
import { useState } from 'react'
import type { WeightEntry } from '@/types'

interface Props {
  entries: WeightEntry[]
  onEntriesChange: (entries: WeightEntry[]) => void
}

const today = () => new Date().toISOString().split('T')[0]

function formatEntryDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function WeightLogWidget({ entries, onEntriesChange }: Props) {
  const [inputKg, setInputKg] = useState<string>(
    entries[0] ? String(entries[0].weight_kg) : ''
  )
  const [inputDate, setInputDate] = useState(today())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  async function handleLog() {
    const weight_kg = parseFloat(inputKg)
    if (isNaN(weight_kg) || weight_kg < 20 || weight_kg > 300) {
      setError('Enter a valid weight between 20 and 300 kg')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/weight-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight_kg, date: inputDate }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const { entry } = await res.json()
      const updated = [entry, ...entries.filter(e => e.date !== entry.date)]
        .sort((a, b) => b.date.localeCompare(a.date))
      onEntriesChange(updated)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setPendingDeleteId(null)
    try {
      const res = await fetch(`/api/weight-log?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      onEntriesChange(entries.filter(e => e.id !== id))
    } catch {
      setError('Failed to delete entry')
    }
  }

  return (
    <div className="space-y-3">
      {/* Input row: weight (wider) + date (narrower) */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label htmlFor="weight-input" className="text-xs font-medium text-slate-500 mb-1 block">
            Weight (kg)
          </label>
          <input
            id="weight-input"
            type="number"
            step="0.1"
            min="20"
            max="300"
            value={inputKg}
            onChange={e => { setInputKg(e.target.value); setError(null) }}
            placeholder="e.g. 75.0"
            className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="weight-date" className="text-xs font-medium text-slate-500 mb-1 block">
            Date
          </label>
          {/* Styled wrapper controls height/appearance; transparent native input captures taps */}
          <div className="relative h-10 rounded-lg border border-slate-200 flex items-center px-3">
            <span className="text-sm text-slate-700 pointer-events-none select-none">
              {formatShortDate(inputDate)}
            </span>
            <input
              id="weight-date"
              type="date"
              value={inputDate}
              onChange={e => setInputDate(e.target.value)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
        </div>
      </div>

      <button
        onClick={handleLog}
        disabled={saving}
        className="w-full bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving…' : 'Log weight'}
      </button>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* History */}
      <div>
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Recent entries</p>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-400 italic py-1">No entries yet — log your weight above.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 overflow-hidden">
            {entries.slice(0, 8).map(e => (
              <div key={e.id} className="flex items-center justify-between px-3 bg-white min-h-[44px]">
                <span className="text-sm text-slate-500">{formatEntryDate(e.date)}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{e.weight_kg} kg</span>
                  {pendingDeleteId === e.id ? (
                    <>
                      <span className="text-xs text-red-500 font-medium">Delete?</span>
                      <button
                        onClick={() => handleDelete(e.id)}
                        className="text-xs font-semibold text-red-500 min-h-[44px] px-1 flex items-center"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setPendingDeleteId(null)}
                        className="text-xs text-slate-400 min-h-[44px] px-1 flex items-center"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setPendingDeleteId(e.id)}
                      className="text-slate-300 hover:text-red-500 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                      aria-label="Delete entry"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
