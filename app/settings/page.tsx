'use client'
import { useEffect, useState } from 'react'

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
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ ok: boolean; message: string } | null>(null)

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
        setNotificationsEnabled(data.notifications_enabled ?? false)
        setIsAdmin(data.is_admin ?? false)
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
              </div>
            )}
          </div>
        )}
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
