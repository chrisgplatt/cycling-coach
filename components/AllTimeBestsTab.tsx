'use client'
import { useEffect, useState } from 'react'
import { SectionCard } from '@/components/RideStats'
import type { AllTimeBests, AllTimeBestsResponse } from '@/lib/ride/all-time-bests'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function BestCell({ label, value, unit, caption, icuActivityId }: { label: string; value: string; unit?: string; caption: string; icuActivityId: string }) {
  return (
    <div className="flex-1 text-center px-2 py-3 sm:px-3 sm:py-4 min-w-[110px]">
      <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
        {value}
        {unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">{label}</div>
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

function BestsSections({ bests }: { bests: AllTimeBests }) {
  const isEmpty = !bests.biggestClimb && !bests.longestClimb
    && bests.powerBests.length === 0 && bests.speedBests.length === 0 && !bests.maxSpeed

  if (isEmpty) {
    return <p className="text-sm text-gray-400 text-center py-8">No ride data yet for this period.</p>
  }

  return (
    <div className="space-y-4">
      {bests.biggestClimb && (
        <SectionCard title="Biggest Climb" accent="bg-emerald-400">
          <div className="flex">
            <BestCell
              label="Elevation" value={String(bests.biggestClimb.elev_gain_m)} unit="m"
              caption={bests.biggestClimb.length_km != null
                ? `${bests.biggestClimb.length_km}km · ${formatDate(bests.biggestClimb.date)}`
                : formatDate(bests.biggestClimb.date)}
              icuActivityId={bests.biggestClimb.icuActivityId}
            />
          </div>
        </SectionCard>
      )}
      {bests.longestClimb && (
        <SectionCard title="Longest Climb" accent="bg-emerald-400">
          <div className="flex">
            <BestCell
              label="Length" value={String(bests.longestClimb.length_km)} unit="km"
              caption={`${bests.longestClimb.elev_gain_m}m gain · ${formatDate(bests.longestClimb.date)}`}
              icuActivityId={bests.longestClimb.icuActivityId}
            />
          </div>
        </SectionCard>
      )}
      {bests.powerBests.length > 0 && (
        <SectionCard title="Power Bests" accent="bg-orange-400">
          <div className="flex divide-x divide-gray-100 overflow-x-auto">
            {bests.powerBests.map(p => (
              <BestCell
                key={p.secs} label={durationLabel(p.secs)} value={String(p.watts)} unit="w"
                caption={formatDate(p.date)}
                icuActivityId={p.icuActivityId}
              />
            ))}
          </div>
        </SectionCard>
      )}
      {bests.speedBests.length > 0 && (
        <SectionCard title="Speed Bests" accent="bg-blue-400">
          <div className="flex divide-x divide-gray-100 overflow-x-auto">
            {bests.speedBests.map(sp => (
              <BestCell
                key={sp.distance_km} label={`${sp.distance_km}km`} value={sp.avg_speed_kmh.toFixed(1)} unit="km/h"
                caption={formatDate(sp.date)}
                icuActivityId={sp.icuActivityId}
              />
            ))}
          </div>
        </SectionCard>
      )}
      {bests.maxSpeed && (
        <SectionCard title="Max Speed" accent="bg-red-400">
          <div className="flex">
            <BestCell
              label="Top Speed" value={bests.maxSpeed.speed_kmh.toFixed(1)} unit="km/h"
              caption={formatDate(bests.maxSpeed.date)}
              icuActivityId={bests.maxSpeed.icuActivityId}
            />
          </div>
        </SectionCard>
      )}
    </div>
  )
}

export default function AllTimeBestsTab() {
  const [data, setData] = useState<AllTimeBestsResponse | null>(null)
  const [loading, setLoading] = useState(true)
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

  const years = Object.keys(data.byYear).sort((a, b) => b.localeCompare(a))
  const current = selectedPeriod === 'all' ? data.allTime : data.byYear[selectedPeriod]

  return (
    <div className="space-y-4">
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
