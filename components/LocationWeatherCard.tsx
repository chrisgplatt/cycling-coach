interface GeoMatch {
  label: string
  latitude: number
  longitude: number
}

interface Props {
  editingLocation: boolean
  locationLabel: string
  savedLocationLabel: string
  locationQuery: string
  geoMatches: GeoMatch[] | null
  geoSearching: boolean
  saving: boolean
  saved: boolean
  inputClass: string
  onLocationQueryChange: (value: string) => void
  onStartEditing: () => void
  onCancelEditing: () => void
  onSave: () => void
  onSearchLocation: () => void
  onSelectLocation: (match: GeoMatch) => void
  onClearLocation: () => void
}

export default function LocationWeatherCard({
  editingLocation, locationLabel, savedLocationLabel, locationQuery, geoMatches, geoSearching,
  saving, saved, inputClass, onLocationQueryChange, onStartEditing, onCancelEditing, onSave,
  onSearchLocation, onSelectLocation, onClearLocation,
}: Props) {
  return (
    <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Location for weather</h2>
        {editingLocation ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              aria-label="Save location"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
            >✓</button>
            <button
              onClick={onCancelEditing}
              aria-label="Cancel"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 transition-colors"
            >✕</button>
          </div>
        ) : (
          <button onClick={onStartEditing} aria-label="Edit location" className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>
        )}
      </div>
      {saved && (
        <p className="text-xs text-emerald-600 font-medium">Saved.</p>
      )}
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
                onClick={onClearLocation}
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
              onChange={e => onLocationQueryChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSearchLocation() } }}
              placeholder="Town or city (e.g. Bristol)"
              className={inputClass}
            />
            <button
              onClick={onSearchLocation}
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
                  onClick={() => onSelectLocation(m)}
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
  )
}
