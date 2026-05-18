'use client'
import { useEffect, useState } from 'react'
import PlanApprovalModal from '@/components/PlanApprovalModal'
import PlanDurationModal from '@/components/PlanDurationModal'
import ClearWorkoutsModal from '@/components/ClearWorkoutsModal'
import AddEventModal from '@/components/AddEventModal'
import type { UserProfile, TrainingEvent, GeneratedPlan, ICUSyncData } from '@/types'

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const
const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

const DEFAULT_PROFILE: UserProfile = {
  full_name: '', goals: '', events: [],
  current_ftp: 200, weight_kg: 70,
  intervals_icu_athlete_id: '', intervals_icu_api_key: '',
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [showDurationPrompt, setShowDurationPrompt] = useState(false)
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null)
  const [planWeeks, setPlanWeeks] = useState(6)
  const [workoutsFound, setWorkoutsFound] = useState(0)
  const [estimatedWorkouts, setEstimatedWorkouts] = useState(0)
  const [syncData, setSyncData] = useState<ICUSyncData | null>(null)
  const [showClearModal, setShowClearModal] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [deletingEvent, setDeletingEvent] = useState<string | null>(null)
  const [confirmingEvent, setConfirmingEvent] = useState<string | null>(null)
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [editingEvent, setEditingEvent] = useState<TrainingEvent | null>(null)
  const [schedule, setSchedule] = useState<Record<string, number>>(
    Object.fromEntries(DAYS.map(d => [d, 0]))
  )

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => {
        if (data?.error) {
          setSaveError(`Could not load profile: ${data.error}`)
          return
        }
        if (data?.id) {
          setProfileId(data.id)
          setProfile({
            full_name: data.full_name ?? '',
            goals: data.goals ?? '',
            events: data.events ?? [],
            current_ftp: data.current_ftp ?? 200,
            weight_kg: data.weight_kg ?? 70,
            intervals_icu_athlete_id: data.intervals_icu_athlete_id ?? '',
            intervals_icu_api_key: data.intervals_icu_api_key ?? '',
          })
          const avail: Array<{ day: string; duration_minutes: number }> = data.weekly_availability ?? []
          setSchedule(
            Object.fromEntries(
              DAYS.map(d => [d, avail.find(a => a.day === d)?.duration_minutes ?? 0])
            )
          )
        }
      })
      .catch(e => setSaveError(`Could not load profile: ${e.message}`))

    fetch('/api/sync', { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then((data: ICUSyncData | null) => {
        if (!data) return
        setSyncData(data)
        if (data.athlete_ftp) setProfile(p => ({ ...p, current_ftp: data.athlete_ftp! }))
        if (data.athlete_weight) setProfile(p => ({ ...p, weight_kg: data.athlete_weight! }))
      })
      .catch(() => {})
  }, [])

  async function saveProfile(): Promise<boolean> {
    setSaving(true)
    setSaveError(null)
    try {
      const weekly_availability = DAYS
        .filter(d => (schedule[d] ?? 0) > 0)
        .map(d => ({ day: d, duration_minutes: schedule[d] }))
      const body = profileId
        ? { id: profileId, ...profile, weekly_availability }
        : { ...profile, weekly_availability }
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.error ?? 'Save failed')
        return false
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        return true
      }
    } catch {
      setSaveError('Network error')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function startPlanGeneration(weeks: number, startDate: string) {
    setShowDurationPrompt(false)
    setPlanWeeks(weeks)
    setGenerating(true)
    setWorkoutsFound(0)
    setEstimatedWorkouts(DAYS.filter(d => (schedule[d] ?? 0) > 0).length * weeks)
    setSaveError(null)
    try {
      const saved = await saveProfile()
      if (!saved) {
        setGenerating(false)
        return
      }
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
      if (!res.body) {
        setSaveError('No response from server')
        return
      }
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
            if (event.type === 'progress') {
              setWorkoutsFound(event.found)
            } else if (event.type === 'done') {
              setGeneratedPlan(event.plan)
            } else if (event.type === 'error') {
              setSaveError(event.message)
            }
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch {
      setSaveError('Network error during plan generation')
    } finally {
      setGenerating(false)
    }
  }

  async function clearFutureWorkouts(): Promise<string> {
    try {
      const res = await fetch('/api/workouts/clear-future', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) return `Error: ${data.error ?? 'Failed'}`
      return `Deleted ${data.deleted} workout${data.deleted !== 1 ? 's' : ''} from intervals.icu${data.failed ? ` (${data.failed} failed)` : ''}`
    } catch {
      return 'Error: Network error'
    }
  }

  async function syncEvents() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/events/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setSyncResult(`Error: ${data.error ?? 'Sync failed'}`)
        return
      }
      setProfile(p => ({ ...p, events: data.events ?? p.events }))
      setSyncResult(
        data.added > 0
          ? `Added ${data.added} event(s) from intervals.icu`
          : 'No new events found'
      )
    } catch {
      setSyncResult('Network error')
    } finally {
      setSyncing(false)
    }
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
      if (!res.ok) {
        setSyncResult(`Error deleting event: ${data.error ?? 'Failed'}`)
        return
      }
      setProfile(p => ({ ...p, events: p.events.filter(e => !(e.name === name && e.date === date)) }))
      if (data.icu_delete_failed) {
        setSyncResult('Event removed locally but could not delete from intervals.icu')
      }
    } catch {
      setSyncResult('Network error')
    } finally {
      setDeletingEvent(null)
    }
  }

  async function addEvent(event: Omit<TrainingEvent, '_key'>) {
    const res = await fetch('/api/events/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Failed to save event')
    setProfile(p => ({ ...p, events: [...p.events, data.event] }))
    if (data.synced_to_icu) {
      setSyncResult('Event saved and synced to intervals.icu')
    } else if (profile.intervals_icu_athlete_id && data.icu_error) {
      setSyncResult(`Event saved locally — intervals.icu sync failed: ${data.icu_error}`)
    }
  }

  async function updateEvent(original: TrainingEvent, updated: Omit<TrainingEvent, '_key'>) {
    const res = await fetch('/api/events/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        original_name: original.name,
        original_date: original.date,
        ...updated,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Failed to update event')
    setProfile(p => ({
      ...p,
      events: p.events.map(e =>
        e.name === original.name && e.date === original.date ? data.event : e
      ),
    }))
    if (data.synced_to_icu) {
      setSyncResult('Event updated and synced to intervals.icu')
    } else if (profile.intervals_icu_athlete_id && data.icu_error) {
      setSyncResult(`Event updated locally — intervals.icu sync failed: ${data.icu_error}`)
    }
  }

  const inputClass = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
  const labelClass = "text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5"

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Configure your profile and training preferences</p>
      </div>

      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">intervals.icu</h2>
        <div className="space-y-3">
          <input
            type="text"
            value={profile.intervals_icu_athlete_id}
            onChange={e => setProfile(p => ({ ...p, intervals_icu_athlete_id: e.target.value }))}
            placeholder="Athlete ID (e.g. i12345)"
            className={inputClass}
          />
          <input
            type="password"
            value={profile.intervals_icu_api_key}
            onChange={e => setProfile(p => ({ ...p, intervals_icu_api_key: e.target.value }))}
            placeholder="API Key"
            className={inputClass}
          />
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Athlete Profile</h2>
        <div>
          <label className={labelClass}>Full Name</label>
          <input
            type="text"
            value={profile.full_name ?? ''}
            onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))}
            placeholder="e.g. Chris Smith"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Goals</label>
          <textarea
            value={profile.goals}
            onChange={e => setProfile(p => ({ ...p, goals: e.target.value }))}
            placeholder="Your goals (e.g. Complete Dragon Ride, improve FTP, lose 5kg)"
            rows={6}
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>FTP (W)</label>
            <input type="number" value={profile.current_ftp}
              onChange={e => setProfile(p => ({ ...p, current_ftp: Number(e.target.value) }))}
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Weight (kg)</label>
            <input type="number" step="0.5" value={profile.weight_kg}
              onChange={e => setProfile(p => ({ ...p, weight_kg: Number(e.target.value) }))}
              className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Weekly Training Availability</label>
          <p className="text-xs text-slate-400 mb-3">How many minutes you can train on each day in a typical week. Leave blank for rest days.</p>
          <div className="space-y-2">
            {DAYS.map((day, i) => (
              <div key={day} className="flex items-center gap-3">
                <span className="text-sm text-slate-600 w-8 shrink-0">{DAY_LABELS[i]}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="0"
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
        </div>
      </section>

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
            <button onClick={() => setShowAddEvent(true)} className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors">
              + Add event
            </button>
          </div>
        </div>
        {syncResult && (
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">{syncResult}</p>
        )}
        {profile.events.length === 0 && (
          <p className="text-sm text-slate-400">No events yet. Add one to start planning.</p>
        )}
        {profile.events.map((event, i) => {
          const key = `${event.name}|${event.date}`
          const typeLabel: Record<string, string> = { race: 'Race', sportive: 'Sportive', holiday: 'Holiday', fitness: 'Fitness' }
          return (
            <div key={key ?? i} className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100 last:border-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{event.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {event.date} · {typeLabel[event.type] ?? event.type} · Priority {event.priority}
                  {event.icu_event_id && <span className="ml-1.5 text-green-600">↑ synced</span>}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => setEditingEvent(event)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                >
                  Edit
                </button>
                {confirmingEvent === key ? (
                  <>
                    <span className="text-xs text-slate-600">Delete?</span>
                    <button
                      onClick={() => { setConfirmingEvent(null); deleteEvent(event.name, event.date) }}
                      disabled={deletingEvent === key}
                      className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
                    >
                      {deletingEvent === key ? 'Deleting…' : 'Yes'}
                    </button>
                    <button
                      onClick={() => setConfirmingEvent(null)}
                      className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmingEvent(key)}
                    className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </section>

      {saveError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{saveError}</div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button onClick={saveProfile} disabled={saving}
          className="bg-slate-800 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors shadow-sm">
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Profile'}
        </button>
        <button onClick={() => setShowDurationPrompt(true)} disabled={generating || !profile.events.length}
          title={!profile.events.length ? 'Add at least one event first' : undefined}
          className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm">
          {generating ? 'Generating plan…' : 'Build New Plan'}
        </button>
        <button onClick={() => setShowClearModal(true)}
          className="bg-red-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-red-700 transition-colors shadow-sm">
          Clear Future Workouts
        </button>
      </div>

      {showAddEvent && (
        <AddEventModal
          onConfirm={addEvent}
          onClose={() => setShowAddEvent(false)}
        />
      )}

      {editingEvent && (
        <AddEventModal
          initialEvent={editingEvent}
          onConfirm={updated => updateEvent(editingEvent, updated)}
          onClose={() => setEditingEvent(null)}
        />
      )}

      {showClearModal && (
        <ClearWorkoutsModal
          onConfirm={clearFutureWorkouts}
          onClose={() => setShowClearModal(false)}
        />
      )}

      {showDurationPrompt && (
        <PlanDurationModal
          onStart={startPlanGeneration}
          onCancel={() => setShowDurationPrompt(false)}
        />
      )}

      {(generating || generatedPlan) && (
        <PlanApprovalModal
          plan={generatedPlan}
          loading={generating}
          weeks={planWeeks}
          workoutsFound={workoutsFound}
          estimatedWorkouts={estimatedWorkouts}
          onApprove={() => { setGeneratedPlan(null); window.location.href = '/dashboard' }}
          onReject={() => { setGeneratedPlan(null) }}
        />
      )}
    </div>
  )
}
