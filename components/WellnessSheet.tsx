'use client'
import { useState } from 'react'
import type { DailyWellness } from '@/types'
import { labelDate } from '@/lib/calendar-helpers'

interface Props {
  date: string
  wellness: DailyWellness | undefined
  onClose: () => void
  onSaved: (w: DailyWellness) => void
}

const METRICS: Array<{ key: keyof Pick<DailyWellness, 'energy' | 'leg_freshness' | 'mood' | 'stress' | 'sleep_quality'>; label: string }> = [
  { key: 'energy', label: 'Energy' },
  { key: 'leg_freshness', label: 'Leg freshness' },
  { key: 'mood', label: 'Mood' },
  { key: 'stress', label: 'Stress' },
  { key: 'sleep_quality', label: 'Sleep quality' },
]

const SCALE_COLORS: Record<number, string> = {
  1: 'bg-red-50 text-red-500 border-red-200',
  2: 'bg-orange-50 text-orange-500 border-orange-200',
  3: 'bg-amber-50 text-amber-500 border-amber-200',
  4: 'bg-green-50 text-green-500 border-green-200',
  5: 'bg-emerald-50 text-emerald-600 border-emerald-200',
}

const SELECTED_COLORS: Record<number, string> = {
  1: 'bg-red-50 text-red-600 border-red-500 border-2 font-bold',
  2: 'bg-orange-50 text-orange-600 border-orange-500 border-2 font-bold',
  3: 'bg-amber-50 text-amber-600 border-amber-500 border-2 font-bold',
  4: 'bg-green-50 text-green-700 border-green-500 border-2 font-bold',
  5: 'bg-emerald-50 text-emerald-700 border-emerald-500 border-2 font-bold',
}

type MetricValues = Record<string, number | null>

export default function WellnessSheet({ date, wellness, onClose, onSaved }: Props) {
  const [values, setValues] = useState<MetricValues>(() => ({
    energy: wellness?.energy ?? null,
    leg_freshness: wellness?.leg_freshness ?? null,
    mood: wellness?.mood ?? null,
    stress: wellness?.stress ?? null,
    sleep_quality: wellness?.sleep_quality ?? null,
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasAnyValue = Object.values(values).some(v => v != null)

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/wellness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, ...values }),
      })
      if (!res.ok) { setError('Failed to save. Please try again.'); return }
      const { wellness: saved } = await res.json()
      onSaved(saved)
      onClose()
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-4 pt-4 pb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">{labelDate(date)}</h2>
              <p className="text-sm text-slate-400">How are you feeling?</p>
            </div>
            <button
              aria-label="close"
              onClick={onClose}
              className="text-slate-400 text-xl w-11 h-11 flex items-center justify-center active:opacity-70"
            >
              ×
            </button>
          </div>

          <div className="flex flex-col gap-5 mb-6">
            {METRICS.map(({ key, label }) => (
              <div key={key}>
                <p className="text-xs font-semibold text-slate-500 mb-2">{label}</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(n => {
                    const selected = values[key] === n
                    return (
                      <button
                        key={n}
                        aria-label={String(n)}
                        onClick={() => setValues(v => ({ ...v, [key]: v[key] === n ? null : n }))}
                        className={`flex-1 h-11 rounded-lg border text-sm transition-all ${
                          selected ? SELECTED_COLORS[n] : SCALE_COLORS[n]
                        }`}
                      >
                        {n}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleSave}
            disabled={!hasAnyValue || saving}
            className="w-full h-11 bg-blue-500 text-white font-semibold rounded-xl disabled:opacity-40 active:bg-blue-600 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {error && <p className="mt-2 text-xs text-red-500 text-center">{error}</p>}
        </div>
      </div>
    </div>
  )
}
