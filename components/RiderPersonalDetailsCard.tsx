import { calculateAge } from '@/lib/age'
import { resolveMaxHr, MAX_HR_SOURCE_LABEL } from '@/lib/max-hr'

interface Props {
  editingName: boolean
  fullName: string
  dob: string
  maxHrManual: string
  savedDob: string
  savedMaxHrManual: string
  observedMaxHr: number | null
  saving: boolean
  saved: boolean
  labelClass: string
  inputClass: string
  onFullNameChange: (value: string) => void
  onDobChange: (value: string) => void
  onMaxHrManualChange: (value: string) => void
  onStartEditing: () => void
  onCancelEditing: () => void
  onSave: () => void
}

export default function RiderPersonalDetailsCard({
  editingName, fullName, dob, maxHrManual, savedDob, savedMaxHrManual, observedMaxHr, saving, saved,
  labelClass, inputClass, onFullNameChange, onDobChange, onMaxHrManualChange,
  onStartEditing, onCancelEditing, onSave,
}: Props) {
  return (
    <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Rider personal details</h2>
        {editingName ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              aria-label="Save personal details"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
            >✓</button>
            <button
              onClick={onCancelEditing}
              aria-label="Cancel"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 transition-colors"
            >✕</button>
          </div>
        ) : (
          <button onClick={onStartEditing} aria-label="Edit personal details" className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>
        )}
      </div>
      {saved && (
        <p className="text-xs text-emerald-600 font-medium">Saved.</p>
      )}
      {editingName ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="full-name" className={labelClass}>Full Name</label>
            <input
              id="full-name"
              type="text"
              value={fullName}
              onChange={e => onFullNameChange(e.target.value)}
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
              onChange={e => onDobChange(e.target.value)}
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
              onChange={e => onMaxHrManualChange(e.target.value)}
              placeholder="e.g. 185"
              className={inputClass}
            />
            {(() => {
              const autoMaxHr = resolveMaxHr({ manual: null, dateOfBirth: dob || null, observed: observedMaxHr })
              return (
                <p className="text-xs text-slate-400 mt-1">
                  {autoMaxHr
                    ? `Leave blank to auto-calculate — currently ${autoMaxHr.value} bpm (${MAX_HR_SOURCE_LABEL[autoMaxHr.source]}).`
                    : 'Leave blank to auto-calculate from date of birth once it’s set.'}
                </p>
              )
            })()}
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
            return maxHr ? (
              <p className="text-sm text-slate-500">{maxHr.value} bpm · {MAX_HR_SOURCE_LABEL[maxHr.source]}</p>
            ) : (
              <p className="text-sm text-slate-400 italic">Max HR not set</p>
            )
          })()}
        </div>
      )}
    </section>
  )
}
