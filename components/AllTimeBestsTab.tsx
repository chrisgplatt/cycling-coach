'use client'
import { useEffect, useState } from 'react'
import { SectionCard } from '@/components/RideStats'
import type { AllTimeBests, IndoorOutdoorBestsResponse } from '@/lib/ride/all-time-bests'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function BestCell({ label, value, unit, caption, icuActivityId, tile, rankBadge }: {
  label: string; value: string; unit?: string; caption: string; icuActivityId: string; tile?: boolean; rankBadge?: number
}) {
  return (
    <div className={tile
      ? 'text-center px-2 py-3 bg-gray-50 rounded-lg'
      : 'flex-1 text-center px-2 py-3 sm:px-3 sm:py-4 min-w-[110px]'
    }>
      <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
        {value}
        {unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">
        {rankBadge ? `#${rankBadge} ` : ''}{label}
      </div>
      <div className="text-[11px] text-gray-400 mt-0.5">{caption}</div>
      <a
        href={`https://intervals.icu/activities/${icuActivityId}`}
        target="_blank"
        rel="noreferrer"
        className="text-[11px] text-blue-500 hover:text-blue-700 underline underline-offset-2"
      >
        View on intervals.icu →
      </a>
    </div>
  )
}

function durationLabel(secs: number): string {
  return secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}min`
}

// Groups a rank-sorted array of entries by a key (duration for power, distance
// for speed) while preserving each group's existing rank order.
function groupByKey<T, K>(items: T[], keyFn: (t: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const group = map.get(key)
    if (group) group.push(item)
    else map.set(key, [item])
  }
  return map
}

// Renders the #1 entry exactly like a plain BestCell. When 2nd/3rd place also
// exist, a chevron toggles them into view below — kept as a sibling button
// (not a wrapper) so it never nests inside the cell's own intervals.icu <a> link.
function ExpandableBestCell<T extends { rank: number; icuActivityId: string }>({
  entries, label, tile, formatValue, formatUnit, formatCaption,
}: {
  entries: T[]
  label: string
  tile?: boolean
  formatValue: (e: T) => string
  formatUnit?: (e: T) => string | undefined
  formatCaption: (e: T) => string
}) {
  const [expanded, setExpanded] = useState(false)
  const [primary, ...rest] = entries
  if (!primary) return null
  return (
    <div className="relative w-full">
      <BestCell
        label={label} value={formatValue(primary)} unit={formatUnit?.(primary)}
        caption={formatCaption(primary)} icuActivityId={primary.icuActivityId} tile={tile}
      />
      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? `Hide ${label} runners-up` : `Show ${label} runners-up`}
          className="absolute top-1 right-1 text-gray-300 hover:text-gray-500 p-1"
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
            strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
      {expanded && rest.map(e => (
        <div key={e.rank} className="mt-1">
          <BestCell
            label={label} value={formatValue(e)} unit={formatUnit?.(e)}
            caption={formatCaption(e)} icuActivityId={e.icuActivityId} tile={tile} rankBadge={e.rank}
          />
        </div>
      ))}
    </div>
  )
}

function BestsSections({ bests }: { bests: AllTimeBests }) {
  const isEmpty = bests.biggestClimb.length === 0 && bests.longestClimb.length === 0
    && bests.powerBests.length === 0 && bests.speedBests.length === 0 && bests.maxSpeed.length === 0

  if (isEmpty) {
    return <p className="text-sm text-gray-400 text-center py-8">No ride data yet for this period.</p>
  }

  const powerByDuration = groupByKey(bests.powerBests, p => p.secs)
  const speedByDistance = groupByKey(bests.speedBests, s => s.distance_km)

  return (
    <div className="space-y-4">
      {bests.biggestClimb.length > 0 && (
        <SectionCard title="Biggest Climb" accent="bg-emerald-400">
          <div className="flex">
            <ExpandableBestCell
              entries={bests.biggestClimb}
              label="Elevation"
              formatValue={c => String(c.elev_gain_m)}
              formatUnit={() => 'm'}
              formatCaption={c => c.length_km != null ? `${c.length_km}km · ${formatDate(c.date)}` : formatDate(c.date)}
            />
          </div>
        </SectionCard>
      )}
      {bests.longestClimb.length > 0 && (
        <SectionCard title="Longest Climb" accent="bg-emerald-400">
          <div className="flex">
            <ExpandableBestCell
              entries={bests.longestClimb}
              label="Length"
              formatValue={c => String(c.length_km)}
              formatUnit={() => 'km'}
              formatCaption={c => `${c.elev_gain_m}m gain · ${formatDate(c.date)}`}
            />
          </div>
        </SectionCard>
      )}
      {bests.powerBests.length > 0 && (
        <SectionCard title="Power Bests" accent="bg-orange-400">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2">
            {[...powerByDuration.entries()].map(([secs, entries]) => (
              <ExpandableBestCell
                key={secs}
                entries={entries}
                label={durationLabel(secs)}
                tile
                formatValue={p => String(p.watts)}
                formatUnit={() => 'w'}
                formatCaption={p => formatDate(p.date)}
              />
            ))}
          </div>
        </SectionCard>
      )}
      {bests.speedBests.length > 0 && (
        <SectionCard title="Speed Bests" accent="bg-blue-400">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2">
            {[...speedByDistance.entries()].map(([distance_km, entries]) => (
              <ExpandableBestCell
                key={distance_km}
                entries={entries}
                label={`${distance_km}km`}
                tile
                formatValue={s => s.avg_speed_kmh.toFixed(1)}
                formatUnit={() => 'km/h'}
                formatCaption={s => formatDate(s.date)}
              />
            ))}
          </div>
        </SectionCard>
      )}
      {bests.maxSpeed.length > 0 && (
        <SectionCard title="Max Speed" accent="bg-red-400">
          <div className="flex">
            <ExpandableBestCell
              entries={bests.maxSpeed}
              label="Top Speed"
              formatValue={m => m.speed_kmh.toFixed(1)}
              formatUnit={() => 'km/h'}
              formatCaption={m => formatDate(m.date)}
            />
          </div>
        </SectionCard>
      )}
    </div>
  )
}

export default function AllTimeBestsTab() {
  const [data, setData] = useState<IndoorOutdoorBestsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSurface, setSelectedSurface] = useState<'outdoor' | 'indoor'>('outdoor')
  const [selectedPeriod, setSelectedPeriod] = useState<'all' | string>('all')

  useEffect(() => {
    fetch('/api/bests')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setData(d))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 rounded-full border-2 border-gray-200 border-t-blue-500" />
      </div>
    )
  }
  if (!data) return <p className="text-sm text-red-600">Could not load bests.</p>

  const surfaceData = data[selectedSurface]
  const years = Object.keys(surfaceData.byYear).sort((a, b) => b.localeCompare(a))
  const current = selectedPeriod === 'all' ? surfaceData.allTime : surfaceData.byYear[selectedPeriod]

  function selectSurface(surface: 'outdoor' | 'indoor') {
    setSelectedSurface(surface)
    setSelectedPeriod('all')
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        <button
          onClick={() => selectSurface('outdoor')}
          className={`flex-1 text-xs font-semibold px-3 py-2.5 rounded-full border transition-colors ${
            selectedSurface === 'outdoor' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          Outdoor
        </button>
        <button
          onClick={() => selectSurface('indoor')}
          className={`flex-1 text-xs font-semibold px-3 py-2.5 rounded-full border transition-colors ${
            selectedSurface === 'indoor' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          Indoor
        </button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none" style={{ touchAction: 'pan-x' }}>
        <button
          onClick={() => setSelectedPeriod('all')}
          className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
            selectedPeriod === 'all' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          All-time
        </button>
        {years.map(year => (
          <button
            key={year}
            onClick={() => setSelectedPeriod(year)}
            className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              selectedPeriod === year ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-500'
            }`}
          >
            {year}
          </button>
        ))}
      </div>
      <BestsSections bests={current} />
    </div>
  )
}
