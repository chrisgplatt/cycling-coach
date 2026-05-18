'use client'
import { useEffect, useRef, useState } from 'react'
import AddEventModal from '@/components/AddEventModal'
import PlanDurationModal from '@/components/PlanDurationModal'
import PlanApprovalModal from '@/components/PlanApprovalModal'
import ClearWorkoutsModal from '@/components/ClearWorkoutsModal'
import type { TrainingEvent, Workout, GeneratedPlan, ICUSyncData } from '@/types'

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

  const [events, setEvents] = useState<TrainingEvent[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [editingEvent, setEditingEvent] = useState<TrainingEvent | null>(null)
  const [deletingEvent, setDeletingEvent] = useState<string | null>(null)
  const [confirmingEvent, setConfirmingEvent] = useState<string | null>(null)

  const [planName, setPlanName] = useState<string | null>(null)
  const [planWorkouts, setPlanWorkouts] = useState<Workout[]>([])
  const [syncData, setSyncData] = useState<ICUSyncData | null>(null)
  const [generating, setGenerating] = useState(false)
  const [showDurationPrompt, setShowDurationPrompt] = useState(false)
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false)
  const [showClearModal, setShowClearModal] = useState(false)
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null)
  const [planWeeks, setPlanWeeks] = useState(6)
  const [workoutsFound, setWorkoutsFound] = useState(0)
  const [estimatedWorkouts, setEstimatedWorkouts] = useState(0)

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
        setEvents(data.events ?? [])
        const avail: Array<{ day: string; duration_minutes: number }> = data.weekly_availability ?? []
        setSchedule(Object.fromEntries(
          DAYS.map(d => [d, avail.find(a => a.day === d)?.duration_minutes ?? 0])
        ))
      })
      // Fix 2: surface load errors instead of silently swallowing them
      .catch(() => setLoadError('Failed to load profile'))

    fetch('/api/plan')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.name) setPlanName(data.name)
        if (data?.workouts) setPlanWorkouts(data.workouts)
      })
      .catch(() => {})

    fetch('/api/sync', { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setSyncData(data) })
      .catch(() => {})
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

  async function syncEvents() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/events/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setSyncResult(`Error: ${data.error ?? 'Sync failed'}`); return }
      setEvents(prev => data.events ?? prev)
      setSyncResult(data.added > 0 ? `Added ${data.added} event(s) from intervals.icu` : 'No new events found')
    } catch { setSyncResult('Network error') }
    finally { setSyncing(false) }
  }

  async function deleteEvent(name: string, date: string) {
    const key = `${name}|${date}`
    setDeletingEvent(key)
    try {
      const res = await fetch('/api/events/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, date }),
      })
      const data = await res.json()
      if (!res.ok) { setSyncResult(`Error deleting event: ${data.error ?? 'Failed'}`); return }
      setEvents(ev => ev.filter(e => !(e.name === name && e.date === date)))
    } catch { setSyncResult('Network error') }
    finally { setDeletingEvent(null); setConfirmingEvent(null) }
  }

  async function addEvent(event: Omit<TrainingEvent, '_key'>) {
    const res = await fetch('/api/events/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Failed to save event')
    setEvents(ev => [...ev, data.event])
  }

  async function updateEvent(original: TrainingEvent, updated: Omit<TrainingEvent, '_key'>) {
    const res = await fetch('/api/events/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ original_name: original.name, original_date: original.date, ...updated }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Failed to update event')
    setEvents(ev => ev.map(e => e.name === original.name && e.date === original.date ? data.event : e))
  }

  function weekNumber(): { current: number; total: number } | null {
    if (planWorkouts.length === 0) return null
    const dates = planWorkouts.map(w => w.date).sort()
    const start = new Date(dates[0])
    const end = new Date(dates[dates.length - 1])
    const total = Math.ceil((end.getTime() - start.getTime()) / (7 * 864e5)) + 1
    const today = new Date()
    const current = Math.max(1, Math.min(total, Math.ceil((today.getTime() - start.getTime()) / (7 * 864e5)) + 1))
    return { current, total }
  }

  function daysToAEvent(): number | null {
    const upcoming = events
      .filter(e => e.priority === 'A')
      .map(e => Math.ceil((new Date(e.date).getTime() - Date.now()) / 864e5))
      .filter(d => d > 0)
      .sort((a, b) => a - b)
    return upcoming[0] ?? null
  }

  async function startPlanGeneration(weeks: number, startDate: string) {
    setShowDurationPrompt(false)
    setPlanWeeks(weeks)
    setGenerating(true)
    setWorkoutsFound(0)
    setEstimatedWorkouts(0)
    setSaveError(null)
    try {
      const profileSaved = await saveProfile()
      if (!profileSaved) { setGenerating(false); return }
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncData, weeks, startDate }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.error ?? 'Plan generation failed')
        return
      }
      if (!res.body) { setSaveError('No response from server'); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            if (event.type === 'total') setEstimatedWorkouts(event.count)
            else if (event.type === 'progress') setWorkoutsFound(event.found)
            else if (event.type === 'done') setGeneratedPlan(event.plan)
            else if (event.type === 'error') setSaveError(event.message)
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch { setSaveError('Network error during plan generation') }
    finally { setGenerating(false) }
  }

  async function clearFutureWorkouts(): Promise<string> {
    try {
      const res = await fetch('/api/workouts/clear-future', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) return `Error: ${data.error ?? 'Failed'}`
      return `Deleted ${data.deleted} workout${data.deleted !== 1 ? 's' : ''}${data.failed ? ` (${data.failed} failed)` : ''}`
    } catch { return 'Error: Network error' }
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
        {planName ? (() => {
          const wk = weekNumber()
          const days = daysToAEvent()
          return (
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-blue-700 to-blue-600 rounded-2xl p-5 text-white shadow-md">
                <p className="text-xs font-bold tracking-widest opacity-60 uppercase mb-2">Active Plan</p>
                <p className="text-xl font-extrabold tracking-tight mb-3">{planName}</p>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  {wk && <span>Week <strong>{wk.current}</strong> of <strong>{wk.total}</strong></span>}
                  {days !== null && <span>🏁 A event in <strong>{days} days</strong></span>}
                  <span>Phase: <strong>Base</strong></span>
                </div>
                {wk && (
                  <div className="mt-4 h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white/80 rounded-full transition-all"
                      style={{ width: `${(wk.current / wk.total) * 100}%` }}
                    />
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50">
                  <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Plan actions</h2>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-sm text-slate-500">
                    Building a new plan will archive the current one and replace all future planned workouts.
                  </p>
                  {saveError && (
                    <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{saveError}</p>
                  )}
                  <div className="flex gap-3 flex-wrap">
                    <button
                      onClick={() => setShowReplaceConfirm(true)}
                      disabled={generating || events.length === 0}
                      title={events.length === 0 ? 'Add at least one event first' : undefined}
                      className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {generating ? 'Generating plan…' : 'Build New Plan'}
                    </button>
                    <button
                      onClick={() => setShowClearModal(true)}
                      className="bg-red-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-red-700 transition-colors shadow-sm"
                    >
                      Clear Future Workouts
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })() : (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-10 text-center space-y-3">
            <p className="text-slate-500 font-medium">No active plan</p>
            <p className="text-sm text-slate-400">Add events on the Events tab, then build your first training plan.</p>
            {saveError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{saveError}</p>
            )}
            <button
              onClick={() => events.length > 0 ? setShowDurationPrompt(true) : setTab('events')}
              disabled={generating}
              className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm mt-2"
            >
              {events.length > 0 ? (generating ? 'Generating plan…' : 'Build New Plan') : 'Add an event first'}
            </button>
          </div>
        )}

        {showReplaceConfirm && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
              <h2 className="text-lg font-bold text-slate-900">Replace active plan?</h2>
              <p className="text-sm text-slate-500">
                You have an active plan: <span className="font-semibold text-slate-700">{planName}</span>.
                Building a new plan will archive it and replace all future planned workouts.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowReplaceConfirm(false)}
                  className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
                >Cancel</button>
                <button
                  onClick={() => { setShowReplaceConfirm(false); setShowDurationPrompt(true) }}
                  className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                >Continue</button>
              </div>
            </div>
          </div>
        )}

        {showDurationPrompt && (
          <PlanDurationModal onStart={startPlanGeneration} onCancel={() => setShowDurationPrompt(false)} />
        )}

        {(generating || generatedPlan) && (
          <PlanApprovalModal
            plan={generatedPlan}
            loading={generating}
            weeks={planWeeks}
            workoutsFound={workoutsFound}
            estimatedWorkouts={estimatedWorkouts}
            onApprove={() => { setGeneratedPlan(null); window.location.href = '/dashboard' }}
            onReject={() => setGeneratedPlan(null)}
          />
        )}

        {showClearModal && (
          <ClearWorkoutsModal onConfirm={clearFutureWorkouts} onClose={() => setShowClearModal(false)} />
        )}
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
        <div className="space-y-4">
          <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Events</h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={syncEvents}
                  disabled={syncing}
                  className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50 transition-colors"
                >
                  {syncing ? 'Syncing…' : 'Sync from intervals.icu'}
                </button>
                <button
                  onClick={() => setShowAddEvent(true)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
                >
                  + Add event
                </button>
              </div>
            </div>
            {syncResult && (
              <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">{syncResult}</p>
            )}
            {events.length === 0 && (
              <p className="text-sm text-slate-400">No events yet. Add one to start planning.</p>
            )}
            {events.map((event, i) => {
              const key = `${event.name}|${event.date}`
              return (
                <div key={key} className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{event.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {event.date} · {event.type} · Priority {event.priority}
                      {event.icu_event_id && <span className="ml-1.5 text-green-600">↑ synced</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => setEditingEvent(event)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                    >Edit</button>
                    {confirmingEvent === key ? (
                      <>
                        <span className="text-xs text-slate-600">Delete?</span>
                        <button
                          onClick={() => deleteEvent(event.name, event.date)}
                          disabled={deletingEvent === key}
                          className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
                        >{deletingEvent === key ? 'Deleting…' : 'Yes'}</button>
                        <button
                          onClick={() => setConfirmingEvent(null)}
                          className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                        >Cancel</button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmingEvent(key)}
                        className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
                      >Delete</button>
                    )}
                  </div>
                </div>
              )
            })}
          </section>
          <p className="text-xs text-slate-400 px-1">
            A-priority events trigger a taper in your plan. B-priority events are treated as hard training days.
          </p>
        </div>

        {showAddEvent && (
          <AddEventModal onConfirm={addEvent} onClose={() => setShowAddEvent(false)} />
        )}
        {editingEvent && (
          <AddEventModal
            initialEvent={editingEvent}
            onConfirm={updated => updateEvent(editingEvent, updated)}
            onClose={() => setEditingEvent(null)}
          />
        )}
      </div>
    </div>
  )
}
