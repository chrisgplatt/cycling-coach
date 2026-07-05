'use client'
import { useEffect, useState } from 'react'
import GarminConnectCard from '@/components/GarminConnectCard'
import RiderPersonalDetailsCard from '@/components/RiderPersonalDetailsCard'
import IntervalsIcuCard from '@/components/IntervalsIcuCard'
import DailyBriefingCard from '@/components/DailyBriefingCard'
import LocationWeatherCard from '@/components/LocationWeatherCard'
import RideHistoryCard from '@/components/RideHistoryCard'
import AboutCard from '@/components/AboutCard'

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
  const [garminLastSyncAt, setGarminLastSyncAt] = useState<string | null>(null)
  const [garminConnecting, setGarminConnecting] = useState(false)
  const [garminError, setGarminError] = useState<string | null>(null)
  const [garminSuccess, setGarminSuccess] = useState(false)
  const [editingGarmin, setEditingGarmin] = useState(false)

  const inputClass = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
  const labelClass = "text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5"

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
        setGarminLastSyncAt(data.garmin_last_sync_at ?? null)
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
      const saveRes = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          garmin_email: garminEmail.trim(),
          garmin_password: garminPassword,
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
        body: JSON.stringify({ garmin_email: null, garmin_password: null }),
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
      <RiderPersonalDetailsCard
        editingName={editingName}
        fullName={fullName}
        dob={dob}
        maxHrManual={maxHrManual}
        savedDob={savedDob}
        savedMaxHrManual={savedMaxHrManual}
        observedMaxHr={observedMaxHr}
        saving={saving}
        labelClass={labelClass}
        inputClass={inputClass}
        onFullNameChange={setFullName}
        onDobChange={setDob}
        onMaxHrManualChange={setMaxHrManual}
        onStartEditing={() => setEditingName(true)}
        onCancelEditing={() => { setFullName(savedFullName); setDob(savedDob); setMaxHrManual(savedMaxHrManual); setEditingName(false); setSaveError(null) }}
        onSave={async () => { const ok = await save(); if (ok) setEditingName(false) }}
      />

      {/* intervals.icu */}
      <IntervalsIcuCard
        editingIcu={editingIcu}
        athleteId={athleteId}
        apiKey={apiKey}
        saving={saving}
        inputClass={inputClass}
        onAthleteIdChange={setAthleteId}
        onApiKeyChange={setApiKey}
        onStartEditing={() => setEditingIcu(true)}
        onCancelEditing={() => { setAthleteId(savedAthleteId); setApiKey(savedApiKey); setEditingIcu(false); setSaveError(null) }}
        onSave={async () => { const ok = await save(); if (ok) setEditingIcu(false) }}
      />

      {/* Garmin Connect */}
      <GarminConnectCard
        garminConnected={garminConnected}
        editingGarmin={editingGarmin}
        garminSuccess={garminSuccess}
        garminEmail={garminEmail}
        garminPassword={garminPassword}
        garminError={garminError}
        garminConnecting={garminConnecting}
        savedGarminEmail={savedGarminEmail}
        garminLastSyncAt={garminLastSyncAt}
        labelClass={labelClass}
        inputClass={inputClass}
        onEmailChange={setGarminEmail}
        onPasswordChange={setGarminPassword}
        onStartEditing={() => setEditingGarmin(true)}
        onCancelEditing={() => {
          setEditingGarmin(false)
          setGarminEmail(savedGarminEmail)
          setGarminPassword('')
          setGarminError(null)
        }}
        onConnect={connectGarmin}
        onDisconnect={disconnectGarmin}
      />

      {/* Daily Briefing */}
      <DailyBriefingCard
        editingBriefing={editingBriefing}
        notifTime={notifTime}
        timezone={timezone}
        notificationsEnabled={notificationsEnabled}
        isAdmin={isAdmin}
        notifWorking={notifWorking}
        notifError={notifError}
        testSending={testSending}
        testResult={testResult}
        saving={saving}
        labelClass={labelClass}
        inputClass={inputClass}
        onNotifTimeChange={setNotifTime}
        onTimezoneChange={setTimezone}
        onStartEditing={() => setEditingBriefing(true)}
        onCancelEditing={() => { setNotifTime(savedNotifTime); setTimezone(savedTimezone); setEditingBriefing(false); setSaveError(null) }}
        onSave={async () => { const ok = await save(); if (ok) setEditingBriefing(false) }}
        onToggleNotifications={toggleNotifications}
        onSendTestNotification={sendTestNotification}
        cronTesting={cronTesting}
        cronTestLogs={cronTestLogs}
        onRunCronTest={runCronTest}
        repushing={repushing}
        repushResult={repushResult}
        onRunRepushPlanned={runRepushPlanned}
        backfilling={backfilling}
        backfillResult={backfillResult}
        onRunBackfillNotes={runBackfillNotes}
        zonesFixing={zonesFixing}
        zonesResult={zonesResult}
        zonesPreview={zonesPreview}
        onPreviewZonesFix={previewZonesFix}
        onApplyZonesFix={applyZonesFix}
      />

      {/* Location for weather */}
      <LocationWeatherCard
        editingLocation={editingLocation}
        locationLabel={locationLabel}
        savedLocationLabel={savedLocationLabel}
        locationQuery={locationQuery}
        geoMatches={geoMatches}
        geoSearching={geoSearching}
        saving={saving}
        inputClass={inputClass}
        onLocationQueryChange={setLocationQuery}
        onStartEditing={() => setEditingLocation(true)}
        onCancelEditing={() => { setLocationLabel(savedLocationLabel); setLatitude(savedLatitude); setLongitude(savedLongitude); setGeoMatches(null); setLocationQuery(''); setEditingLocation(false); setSaveError(null) }}
        onSave={async () => { const ok = await save(); if (ok) { setEditingLocation(false); setGeoMatches(null); setLocationQuery('') } }}
        onSearchLocation={searchLocation}
        onSelectLocation={selectLocation}
        onClearLocation={clearLocation}
      />

      {/* Ride history */}
      <RideHistoryCard
        importing={importing}
        importResult={importResult}
        onImport={async () => {
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
      />

      {/* About */}
      <AboutCard />
    </div>
  )
}
