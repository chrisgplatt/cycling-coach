interface Props {
  editingIcu: boolean
  athleteId: string
  apiKey: string
  saving: boolean
  inputClass: string
  onAthleteIdChange: (value: string) => void
  onApiKeyChange: (value: string) => void
  onStartEditing: () => void
  onCancelEditing: () => void
  onSave: () => void
}

export default function IntervalsIcuCard({
  editingIcu, athleteId, apiKey, saving, inputClass,
  onAthleteIdChange, onApiKeyChange, onStartEditing, onCancelEditing, onSave,
}: Props) {
  return (
    <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">intervals.icu</h2>
        {editingIcu ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              aria-label="Save intervals.icu settings"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
            >✓</button>
            <button
              onClick={onCancelEditing}
              aria-label="Cancel"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 transition-colors"
            >✕</button>
          </div>
        ) : (
          <button onClick={onStartEditing} aria-label="Edit intervals.icu settings" className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>
        )}
      </div>
      {editingIcu ? (
        <div className="space-y-3">
          <input
            type="text"
            value={athleteId}
            onChange={e => onAthleteIdChange(e.target.value)}
            placeholder="Athlete ID (e.g. i12345)"
            className={inputClass}
          />
          <input
            type="password"
            value={apiKey}
            onChange={e => onApiKeyChange(e.target.value)}
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
  )
}
