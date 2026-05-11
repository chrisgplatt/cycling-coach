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

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
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
      .catch(() => {})

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
    if (!profileId) {
      setSaveError('Profile not loaded yet')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: profileId, ...profile }),
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
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncData }),
      })
      if (res.ok) setGeneratedPlan(await res.json())
    } finally {
      setGenerating(false)
    }
  }

  function addEvent() {
    setProfile(p => ({
      ...p,
      events: [...p.events, { name: '', date: '', type: 'sportive' as TrainingEvent['type'], priority: 'B' as TrainingEvent['priority'], _key: Date.now() }],
    }))
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="text-xl font-semibold text-gray-800">Settings</h1>

      <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="font-medium text-gray-700">intervals.icu</h2>
        <div className="space-y-3">
          <input
            type="text"
            value={profile.intervals_icu_athlete_id}
            onChange={e => setProfile(p => ({ ...p, intervals_icu_athlete_id: e.target.value }))}
            placeholder="Athlete ID (e.g. i12345)"
            className="w-full text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password"
            value={profile.intervals_icu_api_key}
            onChange={e => setProfile(p => ({ ...p, intervals_icu_api_key: e.target.value }))}
            placeholder="API Key"
            className="w-full text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </section>

      <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="font-medium text-gray-700">Athlete Profile</h2>
        <textarea
          value={profile.goals}
          onChange={e => setProfile(p => ({ ...p, goals: e.target.value }))}
          placeholder="Your goals (e.g. Complete Dragon Ride, improve FTP, lose 5kg)"
          rows={3}
          className="w-full text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">FTP (W)</label>
            <input type="number" value={profile.current_ftp}
              onChange={e => setProfile(p => ({ ...p, current_ftp: Number(e.target.value) }))}
              className="w-full text-sm border rounded px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Weight (kg)</label>
            <input type="number" step="0.5" value={profile.weight_kg}
              onChange={e => setProfile(p => ({ ...p, weight_kg: Number(e.target.value) }))}
              className="w-full text-sm border rounded px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Weekly hours</label>
            <input type="number" value={profile.weekly_hours}
              onChange={e => setProfile(p => ({ ...p, weekly_hours: Number(e.target.value) }))}
              className="w-full text-sm border rounded px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </section>

      <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-gray-700">Events</h2>
          <button onClick={addEvent} className="text-sm text-blue-600 hover:underline">+ Add event</button>
        </div>
        {profile.events.map((event, i) => (
          <div key={(event as { _key?: number })._key ?? i} className="grid grid-cols-2 gap-2">
            <input type="text" value={event.name} placeholder="Event name"
              onChange={e => { const ev = [...profile.events]; ev[i] = { ...ev[i], name: e.target.value }; setProfile(p => ({ ...p, events: ev })) }}
              className="text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input type="date" value={event.date}
              onChange={e => { const ev = [...profile.events]; ev[i] = { ...ev[i], date: e.target.value }; setProfile(p => ({ ...p, events: ev })) }}
              className="text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={event.type}
              onChange={e => { const ev = [...profile.events]; ev[i] = { ...ev[i], type: e.target.value as TrainingEvent['type'] }; setProfile(p => ({ ...p, events: ev })) }}
              className="text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="sportive">Sportive</option>
              <option value="race">Race</option>
              <option value="holiday">Holiday riding</option>
              <option value="fitness">Fitness</option>
            </select>
            <select value={event.priority}
              onChange={e => { const ev = [...profile.events]; ev[i] = { ...ev[i], priority: e.target.value as TrainingEvent['priority'] }; setProfile(p => ({ ...p, events: ev })) }}
              className="text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="A">A — Peak for this</option>
              <option value="B">B — Important</option>
              <option value="C">C — Secondary</option>
            </select>
          </div>
        ))}
      </section>

      {saveError && (
        <p className="text-sm text-red-600">{saveError}</p>
      )}

      <div className="flex gap-3">
        <button onClick={saveProfile} disabled={saving}
          className="bg-gray-800 text-white text-sm px-6 py-2 rounded hover:bg-gray-900 disabled:opacity-50">
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Profile'}
        </button>
        <button onClick={generatePlan} disabled={generating || !profile.events.length}
          title={!profile.events.length ? 'Add at least one event first' : undefined}
          className="bg-blue-600 text-white text-sm px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
          {generating ? 'Generating plan…' : 'Build New Plan'}
        </button>
      </div>

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
