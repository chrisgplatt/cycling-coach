'use client'
import { useEffect, useState } from 'react'
import { calculateAge } from '@/lib/age'
import { resolveMaxHr } from '@/lib/max-hr'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i)
  return output
}

export default function SettingsPage() {
  const [profileId, setProfileId] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [dob, setDob] = useState('')
  const [savedDob, setSavedDob] = useState('')
  const [maxHrManual, setMaxHrManual] = useState('')
  const [savedMaxHrManual, setSavedMaxHrManual] = useState('')
  const [observedMaxHr, setObservedMaxHr] = useState<number | null>(null)
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
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [notifWorking, setNotifWorking] = useState(false)
  const [notifError, setNotifError] = useState<string | null>(null)
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [cronTesting, setCronTesting] = useState(false)
  const [cronTestLogs, setCronTestLogs] = useState<Array<{ event: string; status: string; details: unknown }> | null>(null)
  const [repushing, setRepushing] = useState(false)
  const [repushResult, setRepushResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [zonesFixing, setZonesFixing] = useState(false)
  const [zonesPreview, setZonesPreview] = useState<{ changeCount: number; total: number } | null>(null)
  const [zonesResult, setZonesResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [locationLabel, setLocationLabel] = useState('')
  const [latitude, setLatitude] = useState<number | null>(null)
  const [longitude, setLongitude] = useState<number | null>(null)
  const [savedLocationLabel, setSavedLocationLabel] = useState('')
  const [locationQuery, setLocationQuery] = useState('')
  const [geoMatches, setGeoMatches] = useState<Array<{ label: string; latitude: number; longitude: number }> | null>(null)
  const [geoSearching, setGeoSearching] = useState(false)
  const [savedLatitude, setSavedLatitude] = useState<number | null>(null)
  const [savedLongitude, setSavedLongitude] = useState<number | null>(null)
  const [editingIcu, setEditingIcu] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editingBriefing, setEditingBriefing] = useState(false)
  const [editingLocation, setEditingLocation] = useState(false)
  const [garminEmail, setGarminEmail] = useState('')
  const [savedGarminEmail, setSavedGarminEmail] = useState('')
  const [garminPassword, setGarminPassword] = useState('')
  const [garminConnected, setGarminConnected] = useState(false)
  const [garminConnecting, setGarminConnecting] = useState(false)
  const [garminError, setGarminError] = useState<string | null>(null)
  const [garminSuccess, setGarminSuccess] = useState(false)
  const [editingGarmin, setEditingGarmin] = useState(false)

  const inputClass = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
  const labelClass = "text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5"
  const TIMEZONE_LABEL: Record<string, string> = {
    'Europe/London': 'London (GMT/BST)',
    'Europe/Paris': 'Paris / Amsterdam (CET)',
    'Europe/Madrid': 'Madrid / Rome (CET)',
    'Europe/Berlin': 'Berlin / Zurich (CET)',
    'America/New_York': 'New York (ET)',
    'America/Chicago': 'Chicago (CT)',
    'America/Denver': 'Denver (MT)',
    'America/Los_Angeles': 'Los Angeles (PT)',
    'Australia/Sydney': 'Sydney (AEST)',
  }

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => {
        if (!data?.id) return
        setProfileId(data.id)
        const name = data.full_name ?? ''
        const dateOfBirth = data.date_of_birth ?? ''
        const id = data.intervals_icu_athlete_id ?? ''
        const key = data.intervals_icu_api_key ?? ''
        setFullName(name); setSavedFullName(name)
        setDob(dateOfBirth); setSavedDob(dateOfBirth)
        const maxHrM = data.max_hr_manual != null ? String(data.max_hr_manual) : ''
        setMaxHrManual(maxHrM); setSavedMaxHrManual(maxHrM)
        setObservedMaxHr(data.observed_max_hr ?? null)
        setAthleteId(id); setSavedAthleteId(id)
        setApiKey(key); setSavedApiKey(key)
        const time = data.notification_time ?? '07:00'
        const tz = data.timezone ?? 'Europe/London'
        setNotifTime(time); setSavedNotifTime(time)
        setTimezone(tz); setSavedTimezone(tz)
        setNotificationsEnabled(data.notifications_enabled ?? false)
        setIsAdmin(data.is_admin ?? false)
        const loc = data.location_label ?? ''
        setLocationLabel(loc); setSavedLocationLabel(loc)
        const lat = typeof data.latitude === 'number' ? data.latitude : null
        const lng = typeof data.longitude === 'number' ? data.longitude : null
        setLatitude(lat); setSavedLatitude(lat)
        setLongitude(lng); setSavedLongitude(lng)
        const ge = data.garmin_email ?? ''
        setGarminEmail(ge); setSavedGarminEmail(ge)
        setGarminConnected(!!ge)
      })
      .catch(() => {})
  }, [])

  async function save(): Promise<boolean> {
    setSaving(true)
    setSaveError(null)
    try {
      const locationFields = { location_label: locationLabel || null, latitude, longitude }
      const maxHrManualNum = maxHrManual.trim() === '' ? null : Number(maxHrManual)
      const body = profileId
        ? { id: profileId, full_name: fullName, date_of_birth: dob || null, max_hr_manual: maxHrManualNum, intervals_icu_athlete_id: athleteId, intervals_icu_api_key: apiKey, notification_time: notifTime, timezone, ...locationFields }
        : { full_name: fullName, date_of_birth: dob || null, max_hr_manual: maxHrManualNum, intervals_icu_athlete_id: athleteId, intervals_icu_api_key: apiKey, notification_time: notifTime, timezone, ...locationFields }
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
        setSavedFullName(fullName)
        setSavedDob(dob)
        setSavedMaxHrManual(maxHrManual)
        setSavedAthleteId(athleteId)
        setSavedApiKey(apiKey)
        setSavedNotifTime(notifTime)
        setSavedTimezone(timezone)
        setSavedLocationLabel(locationLabel)
        setSavedLatitude(latitude)
        setSavedLongitude(longitude)
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

  async function connectGarmin() {
    if (!garminEmail.trim() || !garminPassword.trim()) return
    setGarminConnecting(true)
    setGarminError(null)
    setGarminSuccess(false)
    try {
      const verifyRes = await fetch('/api/garmin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: garminEmail.trim(), password: garminPassword }),
      })
      const verifyData = await verifyRes.json() as { ok: boolean; error?: string }
      if (!verifyData.ok) {
        setGarminError(verifyData.error ?? 'Verification failed')
        return
      }
      // Save credentials and clear cached OAuth token
      const saveRes = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          garmin_email: garminEmail.trim(),
          garmin_password: garminPassword,
          garmin_oauth_token: null,  // clear cached token so next sync does fresh SSO
        }),
      })
      if (!saveRes.ok) {
        const d = await saveRes.json().catch(() => ({})) as { error?: string }
        setGarminError(d.error ?? 'Save failed')
        return
      }
      setSavedGarminEmail(garminEmail.trim())
      setGarminConnected(true)
      setGarminPassword('')
      setGarminSuccess(true)
      setEditingGarmin(false)
      setTimeout(() => setGarminSuccess(false), 3000)
    } catch {
      setGarminError('Network error')
    } finally {
      setGarminConnecting(false)
    }
  }

  async function disconnectGarmin() {
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garmin_email: null, garmin_password: null, garmin_oauth_token: null }),
      })
      if (!res.ok) {
        setGarminError('Failed to disconnect. Please try again.')
        return
      }
      setGarminEmail('')
      setSavedGarminEmail('')
      setGarminPassword('')
      setGarminConnected(false)
      setEditingGarmin(false)
      setGarminError(null)
    } catch {
      setGarminError('Failed to disconnect. Please try again.')
    }
  }

  async function searchLocation() {
    if (!locationQuery.trim()) return
    setGeoSearching(true)
    setGeoMatches(null)
    try {
      const res = await fetch(`/api/profile/geocode?q=${encodeURIComponent(locationQuery.trim())}`)
      const data = await res.json()
      setGeoMatches(data.matches ?? [])
    } catch {
      setGeoMatches([])
    } finally {
      setGeoSearching(false)
    }
  }

  function selectLocation(m: { label: string; latitude: number; longitude: number }) {
    setLocationLabel(m.label)
    setLatitude(m.latitude)
    setLongitude(m.longitude)
    setGeoMatches(null)
    setLocationQuery('')
  }

  function clearLocation() {
    setLocationLabel('')
    setLatitude(null)
    setLongitude(null)
    setGeoMatches(null)
    setLocationQuery('')
  }

  async function toggleNotifications() {
    setNotifWorking(true)
    setNotifError(null)
    try {
      if (notificationsEnabled) {
        // Disable: unsubscribe from push manager and delete from DB
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.ready
          const sub = await registration.pushManager.getSubscription()
          if (sub) {
            const endpoint = sub.endpoint
            await sub.unsubscribe()
            await fetch('/api/notifications/subscribe', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint }),
            })
          }
        }
        setNotificationsEnabled(false)
      } else {
        // Enable: request permission, subscribe, POST to DB
        if (!('Notification' in window) || !('serviceWorker' in navigator)) {
          setNotifError('Push notifications are not supported in this browser.')
          return
        }
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          setNotifError('Notifications were blocked. Enable them in your browser settings, then try again.')
          return
        }
        const registration = await navigator.serviceWorker.ready
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        if (!vapidKey) throw new Error('VAPID key not configured')
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
        })
        const json = subscription.toJSON()
        const res = await fetch('/api/notifications/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }),
        })
        if (!res.ok) throw new Error('Subscribe failed')
        setNotificationsEnabled(true)
      }
    } catch (err) {
      setNotifError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setNotifWorking(false)
    }
  }

  async function runCronTest() {
    setCronTesting(true)
    setCronTestLogs(null)
    try {
      const res = await fetch('/api/cron/test', { method: 'POST' })
      const data = await res.json()
      setCronTestLogs(data.logged ?? [{ event: data.error ?? 'Unknown error', status: 'error', details: null }])
    } catch {
      setCronTestLogs([{ event: 'network_error', status: 'error', details: null }])
    } finally {
      setCronTesting(false)
    }
  }

  async function runRepushPlanned() {
    setRepushing(true)
    setRepushResult(null)
    try {
      const res = await fetch('/api/workouts/repush-planned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await res.json()
      if (res.ok) {
        setRepushResult({
          ok: data.failed === 0,
          message: `${data.updated} updated, ${data.created} created, ${data.skipped} skipped (no steps), ${data.failed} failed.`,
        })
      } else {
        setRepushResult({ ok: false, message: data.error ?? 'Re-push failed.' })
      }
    } catch {
      setRepushResult({ ok: false, message: 'Network error.' })
    } finally {
      setRepushing(false)
    }
  }

  async function runBackfillNotes() {
    setBackfilling(true)
    setBackfillResult(null)
    try {
      const res = await fetch('/api/workouts/backfill-notes', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setBackfillResult({
          ok: data.failed === 0,
          message: data.total === 0 ? 'All planned workouts already have notes.' : `${data.updated} filled, ${data.failed} failed.`,
        })
      } else {
        setBackfillResult({ ok: false, message: data.error ?? 'Backfill failed.' })
      }
    } catch {
      setBackfillResult({ ok: false, message: 'Network error.' })
    } finally {
      setBackfilling(false)
    }
  }

  async function previewZonesFix() {
    setZonesFixing(true)
    setZonesResult(null)
    setZonesPreview(null)
    try {
      const res = await fetch('/api/workouts/backfill-zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await res.json()
      if (res.ok) setZonesPreview({ changeCount: data.changeCount, total: data.total })
      else setZonesResult({ ok: false, message: data.error ?? 'Preview failed.' })
    } catch {
      setZonesResult({ ok: false, message: 'Network error.' })
    } finally {
      setZonesFixing(false)
    }
  }

  async function applyZonesFix() {
    setZonesFixing(true)
    setZonesResult(null)
    try {
      const res = await fetch('/api/workouts/backfill-zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true }),
      })
      const data = await res.json()
      if (res.ok) setZonesResult({ ok: data.failed === 0, message: `${data.updated} corrected, ${data.failed} failed. Re-push to intervals.icu to propagate.` })
      else setZonesResult({ ok: false, message: data.error ?? 'Apply failed.' })
      setZonesPreview(null)
    } catch {
      setZonesResult({ ok: false, message: 'Network error.' })
    } finally {
      setZonesFixing(false)
    }
  }

  async function sendTestNotification() {
    setTestSending(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/notifications/test', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setTestResult({ ok: true, message: 'Test notification sent — check your device.' })
      } else {
        setTestResult({ ok: false, message: data.error ?? 'Send failed.' })
      }
    } catch {
      setTestResult({ ok: false, message: 'Network error.' })
    } finally {
      setTestSending(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Account</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your personal details and connection to intervals.icu</p>
      </div>

      {saveError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{saveError}</div>
      )}

      {/* Rider personal details */}
      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Rider personal details</h2>
          {editingName ? (
            <div className="flex items-center gap-2">
              <button
                onClick={async () => { const ok = await save(); if (ok) setEditingName(false) }}
                disabled={saving}
                aria-label="Save personal details"
                className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
              >✓</button>
              <button
                onClick={() => { setFullName(savedFullName); setDob(savedDob); setMaxHrManual(savedMaxHrManual); setEditingName(false); setSaveError(null) }}
                aria-label="Cancel"
                className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 transition-colors"
              >✕</button>
            </div>
          ) : (
            <button onClick={() => setEditingName(true)} aria-label="Edit personal details" className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>
          )}
        </div>
        {editingName ? (
          <div className="space-y-3">
            <div>
              <label htmlFor="full-name" className={labelClass}>Full Name</label>
              <input
                id="full-name"
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="e.g. Chris Smith"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="date-of-birth" className={labelClass}>Date of birth</label>
              <input
                id="date-of-birth"
                type="date"
                value={dob}
                onChange={e => setDob(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="max-hr-manual" className={labelClass}>Max heart rate (optional)</label>
              <input
                id="max-hr-manual"
                type="number"
                inputMode="numeric"
                value={maxHrManual}
                onChange={e => setMaxHrManual(e.target.value)}
                placeholder="e.g. 185"
                className={inputClass}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {fullName ? (
              <p className="text-sm font-semibold text-slate-800">{fullName}</p>
            ) : (
              <p className="text-sm text-slate-400 italic">Name not set</p>
            )}
            {dob ? (
              <p className="text-sm text-slate-500">Age {calculateAge(dob)}</p>
            ) : (
              <p className="text-sm text-slate-400 italic">Date of birth not set</p>
            )}
            {(() => {
              const maxHr = resolveMaxHr({
                manual: savedMaxHrManual.trim() === '' ? null : Number(savedMaxHrManual),
                dateOfBirth: savedDob || null,
                observed: observedMaxHr,
              })
              const MAX_HR_LABEL: Record<'manual' | 'estimated' | 'observed', string> = {
                manual: 'manual',
                estimated: 'estimated from age',
                observed: 'from your rides',
              }
              return maxHr ? (
                <p className="text-sm text-slate-500">{maxHr.value} bpm · {MAX_HR_LABEL[maxHr.source]}</p>
              ) : (
                <p className="text-sm text-slate-400 italic">Max HR not set</p>
              )
            })()}
          </div>
        )}
      </section>

      {/* intervals.icu */}
      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">intervals.icu</h2>
          {editingIcu ? (
            <div className="flex items-center gap-2">
              <button
                onClick={async () => { const ok = await save(); if (ok) setEditingIcu(false) }}
                disabled={saving}
                aria-label="Save intervals.icu settings"
                className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
              >✓</button>
              <button
                onClick={() => { setAthleteId(savedAthleteId); setApiKey(savedApiKey); setEditingIcu(false); setSaveError(null) }}
                aria-label="Cancel"
                className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 transition-colors"
              >✕</button>
            </div>
          ) : (
            <button onClick={() => setEditingIcu(true)} aria-label="Edit intervals.icu settings" className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>
          )}
        </div>
        {editingIcu ? (
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
        ) : (
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Athlete ID</span>
              <span className={athleteId ? 'font-medium text-slate-800' : 'text-slate-400 italic'}>{athleteId || 'Not set'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">API Key</span>
              <span className={apiKey ? 'font-medium text-slate-800' : 'text-slate-400 italic'}>{apiKey ? '••••••••' : 'Not set'}</span>
            </div>
          </div>
        )}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-slate-700">Ride these workouts in Zwift</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            Your planned workouts can sync straight to Zwift through intervals.icu — no
            extra setup here. In intervals.icu open{' '}
            <a
              href="https://intervals.icu/settings"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 hover:text-blue-700 underline underline-offset-2"
            >
              Settings → Zwift
            </a>{' '}
            and click <span className="font-medium text-slate-600">Connect</span>. The next
            week of sessions then appears in Zwift under{' '}
            <span className="font-medium text-slate-600">Custom Workouts → Intervals.icu</span>.
          </p>
          <p className="text-xs text-amber-600 leading-relaxed">
            Targets are percentages of FTP, so set the <span className="font-medium">same FTP
            in Zwift as in intervals.icu</span> or the watts will be wrong. Open-ended
            (press-lap) warm-ups and recoveries become fixed-duration steps in Zwift.
          </p>
        </div>
      </section>

      {/* Garmin Connect */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Garmin Connect</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {garminConnected
                ? `Connected as ${savedGarminEmail}`
                : 'Connect for training readiness, training status & live body battery'}
            </p>
          </div>
          {garminConnected && !editingGarmin && (
            <button
              onClick={() => setEditingGarmin(true)}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 -m-2 p-2"
            >
              Edit
            </button>
          )}
        </div>
        <div className="px-4 py-4">
          {garminSuccess && (
            <p className="text-xs text-emerald-600 font-medium mb-3">Garmin Connect linked successfully.</p>
          )}
          {(editingGarmin || !garminConnected) ? (
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Garmin email</label>
                <input
                  type="email"
                  value={garminEmail}
                  onChange={e => setGarminEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputClass}
                  autoComplete="email"
                />
              </div>
              <div>
                <label className={labelClass}>Password</label>
                <input
                  type="password"
                  value={garminPassword}
                  onChange={e => setGarminPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputClass}
                  autoComplete="current-password"
                />
              </div>
              {garminError && (
                <p className="text-xs text-red-500">{garminError}</p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={connectGarmin}
                  disabled={garminConnecting || !garminEmail.trim() || !garminPassword.trim()}
                  className="flex-1 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {garminConnecting ? 'Connecting…' : 'Connect'}
                </button>
                {(editingGarmin || garminConnected) && (
                  <button
                    onClick={() => {
                      setEditingGarmin(false)
                      setGarminEmail(savedGarminEmail)
                      setGarminPassword('')
                      setGarminError(null)
                    }}
                    className="py-2.5 px-4 text-sm font-medium text-gray-500 rounded-lg border border-gray-200"
                  >
                    Cancel
                  </button>
                )}
              </div>
              {garminConnected && (
                <button
                  onClick={disconnectGarmin}
                  className="w-full py-3 text-xs text-red-500 hover:text-red-600"
                >
                  Disconnect Garmin
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
              <p className="text-sm text-gray-700">Syncs on each Sync tap</p>
            </div>
          )}
        </div>
      </div>

      {/* Daily Briefing */}
      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Daily Briefing</h2>
          {editingBriefing ? (
            <div className="flex items-center gap-2">
              <button
                onClick={async () => { const ok = await save(); if (ok) setEditingBriefing(false) }}
                disabled={saving}
                aria-label="Save briefing settings"
                className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
              >✓</button>
              <button
                onClick={() => { setNotifTime(savedNotifTime); setTimezone(savedTimezone); setEditingBriefing(false); setSaveError(null) }}
                aria-label="Cancel"
                className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 transition-colors"
              >✕</button>
            </div>
          ) : (
            <button onClick={() => setEditingBriefing(true)} aria-label="Edit briefing settings" className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>
          )}
        </div>
        {editingBriefing ? (
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
        ) : (
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Notification time</span>
              <span className="font-medium text-slate-800">{notifTime}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Timezone</span>
              <span className="font-medium text-slate-800">{TIMEZONE_LABEL[timezone] ?? timezone}</span>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          <div>
            <p className="text-sm font-medium text-slate-700">Push notifications</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {notificationsEnabled === null
                ? 'Loading…'
                : notificationsEnabled
                  ? 'On — daily briefing will arrive at the time above'
                  : 'Off — enable to receive your daily briefing'}
            </p>
          </div>
          <button
            onClick={toggleNotifications}
            disabled={notifWorking || notificationsEnabled === null}
            aria-checked={notificationsEnabled ?? false}
            role="switch"
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
              notificationsEnabled ? 'bg-blue-600' : 'bg-slate-200'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              notificationsEnabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
        {notifError && (
          <p className="text-xs text-amber-600">{notifError}</p>
        )}
        {notificationsEnabled && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-3">
              <button
                onClick={sendTestNotification}
                disabled={testSending}
                className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
              >
                {testSending ? 'Sending…' : 'Send test notification'}
              </button>
              {testResult && (
                <p className={`text-xs ${testResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                  {testResult.message}
                </p>
              )}
            </div>
            {isAdmin && (
              <div className="space-y-2">
                <button
                  onClick={runCronTest}
                  disabled={cronTesting}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
                >
                  {cronTesting ? 'Running…' : 'Test full cron run'}
                </button>
                {cronTestLogs && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                    {cronTestLogs.map((entry, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs font-mono">
                        <span className={`shrink-0 font-semibold ${entry.status === 'ok' ? 'text-emerald-600' : entry.status === 'error' ? 'text-red-500' : 'text-amber-500'}`}>
                          {entry.status === 'ok' ? '✓' : entry.status === 'error' ? '✗' : '–'}
                        </span>
                        <span className="text-slate-700">{entry.event}</span>
                        {entry.details != null && (
                          <span className="text-slate-400 truncate">{JSON.stringify(entry.details)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <button
                    onClick={runRepushPlanned}
                    disabled={repushing}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
                  >
                    {repushing ? 'Re-pushing…' : 'Re-push planned workouts to intervals.icu'}
                  </button>
                  {repushResult && (
                    <p className={`text-xs ${repushResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                      {repushResult.message}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={runBackfillNotes}
                    disabled={backfilling}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
                  >
                    {backfilling ? 'Generating…' : 'Generate coach notes for planned workouts'}
                  </button>
                  {backfillResult && (
                    <p className={`text-xs ${backfillResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                      {backfillResult.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={previewZonesFix}
                      disabled={zonesFixing}
                      className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
                    >
                      {zonesFixing ? 'Checking…' : 'Fix stale FTP watts in planned workouts'}
                    </button>
                    {zonesResult && (
                      <p className={`text-xs ${zonesResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                        {zonesResult.message}
                      </p>
                    )}
                  </div>
                  {zonesPreview && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                      <p className="text-xs text-slate-600">
                        {zonesPreview.changeCount === 0
                          ? 'No planned workouts have stale watts — nothing to correct.'
                          : `${zonesPreview.changeCount} of ${zonesPreview.total} planned workouts have stale watts in their target zones or description.`}
                      </p>
                      {zonesPreview.changeCount > 0 && (
                        <button
                          onClick={applyZonesFix}
                          disabled={zonesFixing}
                          className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg px-3 py-2.5 transition-colors"
                        >
                          {zonesFixing ? 'Applying…' : `Apply correction to ${zonesPreview.changeCount} workout${zonesPreview.changeCount === 1 ? '' : 's'}`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Location for weather */}
      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Location for weather</h2>
          {editingLocation ? (
            <div className="flex items-center gap-2">
              <button
                onClick={async () => { const ok = await save(); if (ok) { setEditingLocation(false); setGeoMatches(null); setLocationQuery('') } }}
                disabled={saving}
                aria-label="Save location"
                className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
              >✓</button>
              <button
                onClick={() => { setLocationLabel(savedLocationLabel); setLatitude(savedLatitude); setLongitude(savedLongitude); setGeoMatches(null); setLocationQuery(''); setEditingLocation(false); setSaveError(null) }}
                aria-label="Cancel"
                className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 transition-colors"
              >✕</button>
            </div>
          ) : (
            <button onClick={() => setEditingLocation(true)} aria-label="Edit location" className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>
          )}
        </div>
        {editingLocation ? (
          <>
            <p className="text-xs text-slate-500 leading-relaxed">
              Used to forecast today&apos;s conditions and advise indoor vs outdoor riding.
              Search for your town or city.
            </p>
            {locationLabel && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <span className="text-sm text-slate-700">{locationLabel}</span>
                <button
                  onClick={clearLocation}
                  className="text-xs font-medium text-slate-400 hover:text-red-500 transition-colors shrink-0 -my-1.5 px-2 py-2.5"
                >
                  Clear
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={locationQuery}
                onChange={e => setLocationQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchLocation() } }}
                placeholder="Town or city (e.g. Bristol)"
                className={inputClass}
              />
              <button
                onClick={searchLocation}
                disabled={geoSearching || !locationQuery.trim()}
                className="shrink-0 text-sm font-medium bg-slate-800 text-white px-4 py-2.5 rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors"
              >
                {geoSearching ? '…' : 'Find'}
              </button>
            </div>
            {geoMatches && geoMatches.length === 0 && (
              <p className="text-xs text-amber-600">No matches — try a nearby town or city name.</p>
            )}
            {geoMatches && geoMatches.length > 0 && (
              <div className="space-y-1.5">
                {geoMatches.map((m, i) => (
                  <button
                    key={i}
                    onClick={() => selectLocation(m)}
                    className="w-full text-left text-sm text-slate-700 rounded-lg border border-slate-200 px-3 py-2.5 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
            {locationLabel && locationLabel !== savedLocationLabel && (
              <p className="text-xs text-emerald-600">Selected: {locationLabel} — press ✓ to save.</p>
            )}
          </>
        ) : locationLabel ? (
          <p className="text-sm font-semibold text-slate-800">{locationLabel}</p>
        ) : (
          <p className="text-sm text-slate-400 italic">No location set.</p>
        )}
      </section>

      {/* Ride history */}
      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Ride history</h2>
        <p className="text-sm text-slate-500">Import rides from the last 3 months to show on the dashboard and calendar even if they had no planned session.</p>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              setImporting(true)
              setImportResult(null)
              try {
                const res = await fetch('/api/workouts/import-rides', { method: 'POST' })
                const data = await res.json()
                if (res.ok) {
                  setImportResult({ ok: true, message: data.imported === 0 ? 'All rides already imported.' : `Imported ${data.imported} ride${data.imported === 1 ? '' : 's'}.` })
                } else {
                  setImportResult({ ok: false, message: data.error ?? 'Import failed.' })
                }
              } catch {
                setImportResult({ ok: false, message: 'Network error.' })
              } finally {
                setImporting(false)
              }
            }}
            disabled={importing}
            className="text-sm font-medium bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors"
          >
            {importing ? 'Importing…' : 'Import ride history'}
          </button>
          {importResult && (
            <p className={`text-sm ${importResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
              {importResult.message}
            </p>
          )}
        </div>
      </section>

      {/* About */}
      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">About</h2>
        <div className="space-y-1.5 text-sm text-slate-500">
          <div className="flex justify-between">
            <span>Version</span>
            <span className="font-medium text-slate-700">{process.env.NEXT_PUBLIC_APP_VERSION ? `v${process.env.NEXT_PUBLIC_APP_VERSION}` : '—'}</span>
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
