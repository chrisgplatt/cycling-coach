'use client'
import { useState } from 'react'
import type { UnavailabilityPeriod, UnavailabilityType } from '@/types'

interface Props {
  period?: UnavailabilityPeriod
  defaultStartDate?: string
  onClose: () => void
  onSaved: (period: UnavailabilityPeriod, impactPlan: boolean) => void
}

const fieldClass = "w-full text-sm border border-slate-200 rounded-xl px-3 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white appearance-none"

const TYPE_OPTIONS: { value: UnavailabilityType; label: string; icon: string }[] = [
  { value: 'sick',        label: 'Sick',        icon: '🤒' },
  { value: 'injury',      label: 'Injury',      icon: '🤕' },
  { value: 'holiday',     label: 'Holiday',     icon: '🏖️' },
  { value: 'unavailable', label: 'Unavailable', icon: '🚫' },
]

export default function AddUnavailabilityModal({ period, defaultStartDate, onClose, onSaved }: Props) {
  const isEditing = !!period
  const [type, setType] = useState<UnavailabilityType>(period?.type ?? 'sick')
  const [startDate, setStartDate] = useState(period?.start_date ?? defaultStartDate ?? '')
  const [endDate, setEndDate] = useState(period?.end_date ?? defaultStartDate ?? '')
  const [notes, setNotes] = useState(period?.notes ?? '')
  const [impactPlan, setImpactPlan] = useState(period?.impact_plan ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = startDate !== '' && endDate !== '' && endDate >= startDate

  async function handleSave() {
    if (!valid) return
    setSaving(true)
    setError(null)
    try {
      const url = isEditing ? '/api/unavailability/update' : '/api/unavailability/create'
      const method = isEditing ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEditing ? { id: period.id } : {}),
          type, start_date: startDate, end_date: endDate,
          notes: notes.trim() || undefined,
          impact_plan: impactPlan,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to save'); return }
      onSaved(data.period as UnavailabilityPeriod, impactPlan)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm max-h-[92vh] flex flex-col overflow-hidden">

        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-2 pt-3 space-y-5">
          <h2 className="text-lg font-bold text-slate-900">
            {isEditing ? 'Edit period' : 'Add unavailability'}
          </h2>

          {/* Type selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    type === opt.value
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <span>{opt.icon}</span> {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Start date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={fieldClass} />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">End date</label>
            <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} className={fieldClass} />
            {endDate && startDate && endDate < startDate && (
              <p className="text-xs text-red-600">End date must be on or after start date.</p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. knee flare-up, family trip to Spain"
              className={fieldClass}
            />
          </div>

          {/* Impact plan toggle */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={impactPlan}
              onChange={e => setImpactPlan(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <p className="text-sm font-medium text-slate-800">Suggest plan adaptations</p>
              <p className="text-xs text-slate-500 mt-0.5">Coach will propose changes to workouts in this window.</p>
            </div>
          </label>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-700 px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!valid || saving}
            className="bg-blue-600 text-white text-sm font-medium px-6 py-3 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add period'}
          </button>
        </div>
      </div>
    </div>
  )
}
