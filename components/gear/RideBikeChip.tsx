'use client'
import { useEffect, useState } from 'react'
import { gearFetch, useGear } from '@/lib/gear/client'
import { resolveBikeForRide } from '@/lib/gear/resolve-bike'
import GearSheet from '@/components/gear/GearSheet'

function BikeIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="w-5 h-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="16.5" r="3.5" />
      <circle cx="18.5" cy="16.5" r="3.5" />
      <path d="M5.5 16.5 9 8h5l4.5 8.5M9 8 12 16.5h-6.5M14 8l-1.5-3H10" />
    </svg>
  )
}

interface Props {
  activityId: string
  isIndoor: boolean
}

/** "Bike: X" chip on a ride, with a picker to override the bike. Hidden until the user has bikes and the ride has a workout row. */
export default function RideBikeChip({ activityId, isIndoor }: Props) {
  const { bikes } = useGear()
  const [ride, setRide] = useState<{ workoutId: string; bikeId: string | null } | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    gearFetch<{ workoutId: string; bikeId: string | null }>(`/api/rides/activity/${activityId}/bike`)
      .then(d => { if (!cancelled && d?.workoutId) setRide({ workoutId: d.workoutId, bikeId: d.bikeId ?? null }) })
      .catch(() => { /* no workout row for this activity → no chip */ })
    return () => { cancelled = true }
  }, [activityId])

  if (!bikes?.length || !ride) return null

  const choices = bikes.filter(b => !b.retired_at)
  const current = bikes.find(b => b.id === ride.bikeId)

  async function assign(bikeId: string) {
    if (!ride) return
    setSaving(true)
    setError(null)
    try {
      await gearFetch(`/api/workouts/${ride.workoutId}/bike`, 'PATCH', { bike_id: bikeId })
      setRide({ ...ride, bikeId })
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const defaultId = resolveBikeForRide({ isIndoor }, choices)

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true) }}
        aria-label={`Bike: ${current?.name ?? 'None'}. ${current ? 'Change' : 'Choose'}`}
        className="w-full flex items-center gap-3 min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-100 bg-white shadow-sm text-left"
      >
        <BikeIcon />
        <span className={`flex-1 min-w-0 truncate text-sm font-semibold ${current ? 'text-slate-900' : 'text-slate-400'}`}>
          {current?.name ?? 'No bike'}
        </span>
        <span aria-hidden className="shrink-0 text-sm font-medium text-blue-600">{current ? 'Change' : 'Choose'} ›</span>
      </button>
      {open && (
        <GearSheet title="Bike for this ride" onClose={() => setOpen(false)}>
          <div className="space-y-2">
            {choices.map(b => (
              <button
                key={b.id}
                disabled={saving}
                aria-current={b.id === ride.bikeId ? 'true' : undefined}
                onClick={() => assign(b.id)}
                className={`w-full flex items-center justify-between text-left px-4 py-3 min-h-[44px] rounded-xl border text-sm font-medium ${b.id === ride.bikeId ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-800'}`}
              >
                {b.name}
                {b.id === ride.bikeId && <span aria-hidden>✓</span>}
              </button>
            ))}
          </div>
          {defaultId && (
            <button
              disabled={saving}
              onClick={() => assign(defaultId)}
              className="w-full min-h-[44px] py-2.5 text-sm font-medium text-blue-600"
            >
              Reset to default
            </button>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </GearSheet>
      )}
    </>
  )
}
