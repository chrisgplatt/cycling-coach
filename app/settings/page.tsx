'use client'
import { useEffect, useState } from 'react'

export default function SettingsPage() {
  const [profileId, setProfileId] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [athleteId, setAthleteId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [savedFullName, setSavedFullName] = useState('')
  const [savedAthleteId, setSavedAthleteId] = useState('')
  const [savedApiKey, setSavedApiKey] = useState('')
  const [notifTime, setNotifTime] = useState('07:00')
  const [timezone, setTimezone] = useState('Europe/London')
  const [savedNotifTime, setSavedNotifTime] = useState('07:00')
  const [savedTimezone, setSavedTimezone] = useState('Europe/London')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const inputClass = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
  const labelClass = "text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5"

  const isDirty = fullName !== savedFullName || athleteId !== savedAthleteId || apiKey !== savedApiKey || notifTime !== savedNotifTime || timezone !== savedTimezone

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => {
        if (!data?.id) return
        setProfileId(data.id)
        const name = data.full_name ?? ''
        const id = data.intervals_icu_athlete_id ?? ''
        const key = data.intervals_icu_api_key ?? ''
        setFullName(name); setSavedFullName(name)
        setAthleteId(id); setSavedAthleteId(id)
        setApiKey(key); setSavedApiKey(key)
        const time = data.notification_time ?? '07:00'
        const tz = data.timezone ?? 'Europe/London'
        setNotifTime(time); setSavedNotifTime(time)
        setTimezone(tz); setSavedTimezone(tz)
      })
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const body = profileId
        ? { id: profileId, full_name: fullName, intervals_icu_athlete_id: athleteId, intervals_icu_api_key: apiKey, notification_time: notifTime, timezone }
        : { full_name: fullName, intervals_icu_athlete_id: athleteId, intervals_icu_api_key: apiKey, notification_time: notifTime, timezone }
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.error ?? 'Save failed')
      } else {
        setSavedFullName(fullName)
        setSavedAthleteId(athleteId)
        setSavedApiKey(apiKey)
        setSavedNotifTime(notifTime)
        setSavedTimezone(timezone)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch {
      setSaveError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Account</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your name and connection to intervals.icu</p>
      </div>

      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">intervals.icu</h2>
        <div className="space-y-3">
          <input
            type="text"
            value={athleteId}
            onChange={e => setAthleteId(e.target.value)}
            placeholder="Athlete ID (e.g. i12345)"
            className={inputClass}
          />
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="API Key"
            className={inputClass}
          />
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Name</h2>
        <div>
          <label className={labelClass}>Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="e.g. Chris Smith"
            className={inputClass}
          />
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Daily Briefing</h2>
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Notification time</label>
            <input
              type="time"
              value={notifTime}
              onChange={e => setNotifTime(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Timezone</label>
            <select
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              className={inputClass}
            >
              <option value="Europe/London">London (GMT/BST)</option>
              <option value="Europe/Paris">Paris / Amsterdam (CET)</option>
              <option value="Europe/Madrid">Madrid / Rome (CET)</option>
              <option value="Europe/Berlin">Berlin / Zurich (CET)</option>
              <option value="America/New_York">New York (ET)</option>
              <option value="America/Chicago">Chicago (CT)</option>
              <option value="America/Denver">Denver (MT)</option>
              <option value="America/Los_Angeles">Los Angeles (PT)</option>
              <option value="Australia/Sydney">Sydney (AEST)</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-400">Enable notifications on the dashboard to receive your daily briefing at this time.</p>
      </section>

      {saveError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{saveError}</div>
      )}

      <button
        onClick={save}
        disabled={saving || !isDirty}
        className="bg-slate-800 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors shadow-sm"
      >
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
      </button>

      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">About</h2>
        <div className="space-y-1.5 text-sm text-slate-500">
          <div className="flex justify-between">
            <span>Version</span>
            <span className="font-medium text-slate-700">{process.env.NEXT_PUBLIC_APP_VERSION ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span>Built</span>
            <span className="font-medium text-slate-700">
              {process.env.NEXT_PUBLIC_BUILD_DATE
                ? new Date(process.env.NEXT_PUBLIC_BUILD_DATE).toLocaleString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })
                : '—'}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
