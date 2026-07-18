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

type ActionResult = { ok: boolean; message: string } | null

interface Props {
  editingBriefing: boolean
  notifTime: string
  timezone: string
  notificationsEnabled: boolean | null
  isAdmin: boolean
  notifWorking: boolean
  notifError: string | null
  testSending: boolean
  testResult: ActionResult
  saving: boolean
  saved: boolean
  labelClass: string
  inputClass: string
  onNotifTimeChange: (value: string) => void
  onTimezoneChange: (value: string) => void
  onStartEditing: () => void
  onCancelEditing: () => void
  onSave: () => void
  onToggleNotifications: () => void
  onSendTestNotification: () => void
  cronTesting: boolean
  cronTestLogs: Array<{ event: string; status: string; details: unknown }> | null
  onRunCronTest: () => void
  repushing: boolean
  repushResult: ActionResult
  onRunRepushPlanned: () => void
  backfilling: boolean
  backfillResult: ActionResult
  onRunBackfillNotes: () => void
  zonesFixing: boolean
  zonesResult: ActionResult
  zonesPreview: { changeCount: number; total: number } | null
  onPreviewZonesFix: () => void
  onApplyZonesFix: () => void
  ftpBackfilling: boolean
  ftpBackfillResult: ActionResult
  onRunBackfillFtp: () => void
  strainBackfilling: boolean
  strainBackfillResult: ActionResult
  onRunBackfillStrain: () => void
}

export default function DailyBriefingCard({
  editingBriefing, notifTime, timezone, notificationsEnabled, isAdmin, notifWorking, notifError,
  testSending, testResult, saving, saved, labelClass, inputClass,
  onNotifTimeChange, onTimezoneChange, onStartEditing, onCancelEditing, onSave,
  onToggleNotifications, onSendTestNotification,
  cronTesting, cronTestLogs, onRunCronTest,
  repushing, repushResult, onRunRepushPlanned,
  backfilling, backfillResult, onRunBackfillNotes,
  zonesFixing, zonesResult, zonesPreview, onPreviewZonesFix, onApplyZonesFix,
  ftpBackfilling, ftpBackfillResult, onRunBackfillFtp,
  strainBackfilling, strainBackfillResult, onRunBackfillStrain,
}: Props) {
  return (
    <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Daily Briefing</h2>
        {editingBriefing ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              aria-label="Save briefing settings"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
            >✓</button>
            <button
              onClick={onCancelEditing}
              aria-label="Cancel"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 transition-colors"
            >✕</button>
          </div>
        ) : (
          <button onClick={onStartEditing} aria-label="Edit briefing settings" className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>
        )}
      </div>
      {saved && (
        <p className="text-xs text-emerald-600 font-medium">Saved.</p>
      )}
      {editingBriefing ? (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Notification time</label>
            <input
              type="time"
              value={notifTime}
              onChange={e => onNotifTimeChange(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Timezone</label>
            <select
              value={timezone}
              onChange={e => onTimezoneChange(e.target.value)}
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
          onClick={onToggleNotifications}
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
              onClick={onSendTestNotification}
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
                onClick={onRunCronTest}
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
                  onClick={onRunRepushPlanned}
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
                  onClick={onRunBackfillNotes}
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
              <div className="flex items-center gap-3">
                <button
                  onClick={onRunBackfillFtp}
                  disabled={ftpBackfilling}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
                >
                  {ftpBackfilling ? 'Backfilling…' : 'Backfill FTP for completed workouts'}
                </button>
                {ftpBackfillResult && (
                  <p className={`text-xs ${ftpBackfillResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {ftpBackfillResult.message}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={onRunBackfillStrain}
                  disabled={strainBackfilling}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
                >
                  {strainBackfilling ? 'Backfilling…' : 'Backfill historical strain'}
                </button>
                {strainBackfillResult && (
                  <p className={`text-xs ${strainBackfillResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {strainBackfillResult.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={onPreviewZonesFix}
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
                        onClick={onApplyZonesFix}
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
  )
}
