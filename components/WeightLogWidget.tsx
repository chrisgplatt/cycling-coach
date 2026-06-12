'use client'
import { useState } from 'react'
import type { WeightEntry } from '@/types'

interface Props {
  entries: WeightEntry[]
  onEntriesChange: (entries: WeightEntry[]) => void
}

const today = () => new Date().toISOString().split('T')[0]

export default function WeightLogWidget({ entries, onEntriesChange }: Props) {
  const [inputKg, setInputKg] = useState<string>(
    entries[0] ? String(entries[0].weight_kg) : ''
  )
  const [inputDate, setInputDate] = useState(today())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLog() {
    const weight_kg = parseFloat(inputKg)
    if (!weight_kg || weight_kg < 20 || weight_kg > 300) {
      setError('Enter a valid weight (20–300 kg)')
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
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
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label htmlFor="weight-input" className="text-xs font-medium text-slate-500 mb-1 block">Weight (kg)</label>
          <input
            id="weight-input"
            type="number"
            step="0.1"
            value={inputKg}
            onChange={e => setInputKg(e.target.value)}
            placeholder="75.0"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="weight-date" className="text-xs font-medium text-slate-500 mb-1 block">Date</label>
          <input
            id="weight-date"
            type="date"
            value={inputDate}
            onChange={e => setInputDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={handleLog}
          disabled={saving}
          className="shrink-0 bg-blue-600 text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Log'}
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {entries.length > 0 && (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 overflow-hidden">
          {entries.slice(0, 8).map(e => (
            <div key={e.id} className="flex items-center justify-between px-3 py-2.5 bg-white">
              <span className="text-sm text-slate-600">{e.date}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-800">{e.weight_kg} kg</span>
                <button
                  onClick={() => handleDelete(e.id)}
                  className="text-xs text-slate-400 hover:text-red-500 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  aria-label="Delete entry"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
