'use client'
import { useEffect, useRef, useState } from 'react'

type Tab = 'plan' | 'profile' | 'events'

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const
const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

const inputClass = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
const labelClass = "text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5"

export default function PlanPage() {
  const [tab, setTab] = useState<Tab>('plan')

  // Profile state
  const [profileId, setProfileId] = useState<string | null>(null)
  const [goals, setGoals] = useState('')
  const [currentFtp, setCurrentFtp] = useState(200)
  const [weightKg, setWeightKg] = useState(70)
  const [schedule, setSchedule] = useState<Record<string, number>>(
    Object.fromEntries(DAYS.map(d => [d, 0]))
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Fix 1: timer ref to avoid unmount leak and double-save race
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => {
        if (!data?.id) return
        setProfileId(data.id)
        setGoals(data.goals ?? '')
        setCurrentFtp(data.current_ftp ?? 200)
        setWeightKg(data.weight_kg ?? 70)
        const avail: Array<{ day: string; duration_minutes: number }> = data.weekly_availability ?? []
        setSchedule(Object.fromEntries(
          DAYS.map(d => [d, avail.find(a => a.day === d)?.duration_minutes ?? 0])
        ))
      })
      // Fix 2: surface load errors instead of silently swallowing them
      .catch(() => setLoadError('Failed to load profile'))
  }, [])

  // Fix 1: cleanup effect for the saved timer
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  async function saveProfile(): Promise<boolean> {
    setSaving(true)
    setSaveError(null)
    try {
      const weekly_availability = DAYS
        .filter(d => (schedule[d] ?? 0) > 0)
        .map(d => ({ day: d, duration_minutes: schedule[d] }))
      const body = profileId
        ? { id: profileId, goals, current_ftp: currentFtp, weight_kg: weightKg, weekly_availability }
        : { goals, current_ftp: currentFtp, weight_kg: weightKg, weekly_availability }
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.error ?? 'Save failed')
        return false
      }
      setSaved(true)
      // Fix 1: clear any existing timer before setting a new one
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 2000)
      return true
    } catch {
      setSaveError('Network error')
      return false
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Training Plan</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your plan, profile, and events</p>
      </div>

      <div className="flex border-b border-slate-200">
        {([['plan', 'My Plan'], ['profile', 'Profile & Schedule'], ['events', 'Events']] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id as Tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* MY PLAN TAB */}
      <div data-testid="tab-plan" style={{ display: tab === 'plan' ? 'block' : 'none' }}>
        <p className="text-sm text-slate-400">Coming soon…</p>
      </div>

      {/* PROFILE & SCHEDULE TAB */}
      <div data-testid="tab-profile" style={{ display: tab === 'profile' ? 'block' : 'none' }}>
        <div className="space-y-4">
          {/* Fix 2: show load error banner */}
          {loadError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{loadError}</div>
          )}

          <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
            {/* Fix 3: use <label htmlFor> instead of <h2> for the Goals textarea */}
            <label htmlFor="goals" className="text-sm font-bold text-slate-700 uppercase tracking-wider">Goals</label>
            <textarea
              id="goals"
              value={goals}
              onChange={e => setGoals(e.target.value)}
              placeholder="Your goals (e.g. Complete Dragon Ride, improve FTP, lose 5kg)"
              rows={5}
              className={inputClass}
            />
          </section>

          <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Athlete stats</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="ftp" className={labelClass}>FTP (W)</label>
                {/* Fix 5: remove redundant aria-label, htmlFor association is sufficient */}
                <input
                  id="ftp"
                  type="number"
                  value={currentFtp}
                  onChange={e => setCurrentFtp(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="weight" className={labelClass}>Weight (kg)</label>
                {/* Fix 5: remove redundant aria-label, htmlFor association is sufficient */}
                <input
                  id="weight"
                  type="number"
                  step="0.5"
                  value={weightKg}
                  onChange={e => setWeightKg(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Weekly Training Availability</h2>
            <p className="text-xs text-slate-400">How many minutes you can train each day. Leave blank for rest days.</p>
            <div className="space-y-2">
              {DAYS.map((day, i) => (
                <div key={day} className="flex items-center gap-3">
                  <span className="text-sm text-slate-600 w-8 shrink-0">{DAY_LABELS[i]}</span>
                  {/* Fix 4: add aria-label so each schedule input is accessible */}
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="0"
                    aria-label={`${DAY_LABELS[i]} training minutes`}
                    value={(schedule[day] ?? 0) === 0 ? '' : String(schedule[day])}
                    onFocus={e => e.target.select()}
                    onChange={e => {
                      const val = parseInt(e.target.value.replace(/\D/g, ''), 10)
                      setSchedule(s => ({ ...s, [day]: isNaN(val) ? 0 : Math.max(0, val) }))
                    }}
                    className="w-24 text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <span className="text-xs text-slate-400 w-6">
                    {(schedule[day] ?? 0) === 0 ? 'rest' : 'min'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {saveError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{saveError}</div>
          )}

          <button
            onClick={saveProfile}
            disabled={saving}
            className="bg-slate-800 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors shadow-sm w-full"
          >
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Profile'}
          </button>
        </div>
      </div>

      {/* EVENTS TAB */}
      <div data-testid="tab-events" style={{ display: tab === 'events' ? 'block' : 'none' }}>
        <p className="text-sm text-slate-400">Coming soon…</p>
      </div>
    </div>
  )
}
