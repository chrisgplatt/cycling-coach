'use client'
import { useEffect, useState } from 'react'
import PlanApprovalModal from '@/components/PlanApprovalModal'
import type { UserProfile, TrainingEvent, GeneratedPlan, ICUSyncData } from '@/types'

const DEFAULT_PROFILE: UserProfile = {
  goals: '', events: [], weekly_hours: 8, rest_days: ['monday'],
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
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null)
  const [syncData, setSyncData] = useState<ICUSyncData | null>(null)
  const [clearing, setClearing] = useState(false)
  const [clearResult, setClearResult] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [deletingEvent, setDeletingEvent] = useState<string | null>(null)

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
            goals: data.goals ?? '',
            events: data.events ?? [],
            weekly_hours: data.weekly_hours ?? 8,
            rest_days: data.rest_days ?? ['monday'],
            current_ftp: data.current_ftp ?? 200,
            weight_kg: data.weight_kg ?? 70,
            intervals_icu_athlete_id: data.intervals_icu_athlete_id ?? '',
            intervals_icu_api_key: data.intervals_icu_api_key ?? '',
          })
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

  async function saveProfile() {
    setSaving(true)
    setSaveError(null)
    try {
      const body = profileId ? { id: profileId, ...profile } : profile
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.error ?? 'Save failed')
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch {
      setSaveError('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function generatePlan() {
    setGenerating(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncData }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data.error ?? 'Plan generation failed')
        return
      }
      setGeneratedPlan(data)
    } catch {
      setSaveError('Network error during plan generation')
    } finally {
      setGenerating(false)
    }
  }

  async function clearFutureWorkouts() {
    setClearing(true)
    setClearResult(null)
    try {
      const res = await fetch('/api/workouts/clear-future', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setClearResult(`Error: ${data.error ?? 'Failed'}`)
      } else {
        setClearResult(`Deleted ${data.deleted} workout${data.deleted !== 1 ? 's' : ''} from intervals.icu${data.failed ? ` (${data.failed} failed)` : ''}`)
      }
    } catch {
      setClearResult('Network error')
    } finally {
      setClearing(false)
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

  function addEvent() {
    setProfile(p => ({
      ...p,
      events: [...p.events, { name: '', date: '', type: 'sportive' as TrainingEvent['type'], priority: 'B' as TrainingEvent['priority'], _key: Date.now() }],
    }))
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
          <label className={labelClass}>Goals</label>
          <textarea
            value={profile.goals}
            onChange={e => setProfile(p => ({ ...p, goals: e.target.value }))}
            placeholder="Your goals (e.g. Complete Dragon Ride, improve FTP, lose 5kg)"
            rows={3}
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
          <div>
            <label className={labelClass}>Weekly hours</label>
            <input type="number" value={profile.weekly_hours}
              onChange={e => setProfile(p => ({ ...p, weekly_hours: Number(e.target.value) }))}
              className={inputClass} />
          </div>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Events</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={syncEvents}
              disabled={syncing}
              className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50 transition-colors"
            >
              {syncing ? 'Syncing…' : 'Sync from intervals.icu'}
            </button>
            <button onClick={addEvent} className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors">
              + Add event
            </button>
          </div>
        </div>
        {syncResult && (
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">{syncResult}</p>
        )}
        {profile.events.map((event, i) => (
          <div key={(event as { _key?: number })._key ?? i} className="grid grid-cols-2 gap-2 pb-4 border-b border-slate-100 last:border-0 last:pb-0">
            <input type="text" value={event.name} placeholder="Event name"
              onChange={e => { const ev = [...profile.events]; ev[i] = { ...ev[i], name: e.target.value }; setProfile(p => ({ ...p, events: ev })) }}
              className={inputClass} />
            <input type="date" value={event.date}
              onChange={e => { const ev = [...profile.events]; ev[i] = { ...ev[i], date: e.target.value }; setProfile(p => ({ ...p, events: ev })) }}
              className={inputClass} />
            <select value={event.type}
              onChange={e => { const ev = [...profile.events]; ev[i] = { ...ev[i], type: e.target.value as TrainingEvent['type'] }; setProfile(p => ({ ...p, events: ev })) }}
              className={inputClass}>
              <option value="sportive">Sportive</option>
              <option value="race">Race</option>
              <option value="holiday">Holiday riding</option>
              <option value="fitness">Fitness</option>
            </select>
            <select value={event.priority}
              onChange={e => { const ev = [...profile.events]; ev[i] = { ...ev[i], priority: e.target.value as TrainingEvent['priority'] }; setProfile(p => ({ ...p, events: ev })) }}
              className={inputClass}>
              <option value="A">A — Peak for this</option>
              <option value="B">B — Important</option>
              <option value="C">C — Secondary</option>
            </select>
            <div className="col-span-2 flex justify-end">
              <button
                onClick={() => deleteEvent(event.name, event.date)}
                disabled={deletingEvent === `${event.name}|${event.date}`}
                className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
              >
                {deletingEvent === `${event.name}|${event.date}` ? 'Deleting…' : 'Delete event'}
              </button>
            </div>
          </div>
        ))}
      </section>

      {saveError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{saveError}</div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button onClick={saveProfile} disabled={saving}
          className="bg-slate-800 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors shadow-sm">
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Profile'}
        </button>
        <button onClick={generatePlan} disabled={generating || !profile.events.length}
          title={!profile.events.length ? 'Add at least one event first' : undefined}
          className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm">
          {generating ? 'Generating plan…' : 'Build New Plan'}
        </button>
        <button onClick={clearFutureWorkouts} disabled={clearing}
          className="bg-red-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors shadow-sm">
          {clearing ? 'Clearing…' : 'Clear Future Workouts'}
        </button>
      </div>

      {clearResult && (
        <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-4 py-2.5">{clearResult}</p>
      )}

      {generatedPlan && (
        <PlanApprovalModal
          plan={generatedPlan}
          onApprove={() => { setGeneratedPlan(null); window.location.href = '/dashboard' }}
          onReject={() => setGeneratedPlan(null)}
        />
      )}
    </div>
  )
}
