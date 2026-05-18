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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const inputClass = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
  const labelClass = "text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5"

  const isDirty = fullName !== savedFullName || athleteId !== savedAthleteId || apiKey !== savedApiKey

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
      })
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const body = profileId
        ? { id: profileId, full_name: fullName, intervals_icu_athlete_id: athleteId, intervals_icu_api_key: apiKey }
        : { full_name: fullName, intervals_icu_athlete_id: athleteId, intervals_icu_api_key: apiKey }
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
    </div>
  )
}
