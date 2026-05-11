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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null)
  const [syncData, setSyncData] = useState<ICUSyncData | null>(null)

  useEffect(() => {
    // Load profile from localStorage (persisted from previous visits)
    const stored = localStorage.getItem('cc_profile')
    if (stored) {
      try { setProfile(JSON.parse(stored)) } catch {}
    }
    // Sync from intervals.icu to get current FTP/weight
    fetch('/api/sync', { method: 'POST' }).then(r => r.json()).then((data: ICUSyncData) => {
      setSyncData(data)
      if (data?.athlete_ftp) setProfile(p => ({ ...p, current_ftp: data.athlete_ftp! }))
      if (data?.athlete_weight) setProfile(p => ({ ...p, weight_kg: data.athlete_weight! }))
    }).catch(() => {})
  }, [])

  async function saveProfile() {
    setSaving(true)
    localStorage.setItem('cc_profile', JSON.stringify(profile))
    setSaved(true)
    setSaving(false)
    setTimeout(() => setSaved(false), 2000)
  }

  async function generatePlan() {
    setGenerating(true)
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, syncData }),
    })
    if (res.ok) setGeneratedPlan(await res.json())
    setGenerating(false)
  }

  function addEvent() {
    setProfile(p => ({
      ...p,
      events: [...p.events, { name: '', date: '', type: 'sportive', priority: 'B' } as TrainingEvent],
    }))
  }

  function updateEvent(i: number, patch: Partial<TrainingEvent>) {
    setProfile(p => {
      const events = [...p.events]
      events[i] = { ...events[i], ...patch }
      return { ...p, events }
    })
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="text-xl font-semibold text-gray-800">Settings</h1>

      <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="font-medium text-gray-700">intervals.icu</h2>
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
          <div key={i} className="grid grid-cols-2 gap-2">
            <input type="text" value={event.name} placeholder="Event name"
              onChange={e => updateEvent(i, { name: e.target.value })}
              className="text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input type="date" value={event.date}
              onChange={e => updateEvent(i, { date: e.target.value })}
              className="text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={event.type}
              onChange={e => updateEvent(i, { type: e.target.value as TrainingEvent['type'] })}
              className="text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="sportive">Sportive</option>
              <option value="race">Race</option>
              <option value="holiday">Holiday riding</option>
              <option value="fitness">Fitness</option>
            </select>
            <select value={event.priority}
              onChange={e => updateEvent(i, { priority: e.target.value as TrainingEvent['priority'] })}
              className="text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="A">A — Peak for this</option>
              <option value="B">B — Important</option>
              <option value="C">C — Secondary</option>
            </select>
          </div>
        ))}
      </section>

      <div className="flex gap-3">
        <button onClick={saveProfile} disabled={saving}
          className="bg-gray-800 text-white text-sm px-6 py-2 rounded hover:bg-gray-900 disabled:opacity-50">
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Profile'}
        </button>
        <button onClick={generatePlan} disabled={generating || !profile.events.length}
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
