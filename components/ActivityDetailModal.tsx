'use client'
import { useEffect, useState } from 'react'
import type { ICUActivity, RideStreams } from '@/types'
import RideStats, { rideStatsFromActivity } from './RideStats'
import RideMapGraph from './ride/RideMapGraph'
import TabBar from './TabBar'

interface Props {
  activity: ICUActivity
  onClose: () => void
}

export default function ActivityDetailModal({ activity, onClose }: Props) {
  const date = new Date(activity.start_date_local)
  const dateStr = date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })

  const [tab, setTab] = useState<'stats' | 'map'>('stats')
  const [streams, setStreams] = useState<RideStreams | null>(null)
  const [streamsError, setStreamsError] = useState(false)

  // Lazy-load streams the first time the Map tab is opened.
  useEffect(() => {
    if (tab !== 'map' || streams || streamsError) return
    let cancelled = false
    fetch(`/api/rides/activity/${activity.id}/streams`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) { if (d?.streams) setStreams(d.streams); else setStreamsError(true) } })
      .catch(() => { if (!cancelled) setStreamsError(true) })
    return () => { cancelled = true }
  }, [tab, streams, streamsError, activity.id])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between gap-3 p-6 pb-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-sky-500 uppercase tracking-wide">Activity</p>
            <h2 className="text-lg font-bold text-slate-900 truncate">{activity.name || 'Ride'}</h2>
            <p className="text-sm text-slate-500">{dateStr}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-sm font-medium min-h-[44px] px-2 shrink-0"
          >
            Close
          </button>
        </div>

        <TabBar
          tabs={[{ id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }]}
          activeId={tab}
          onSelect={(id) => setTab(id as 'stats' | 'map')}
        />

        <div className="flex-1 overflow-y-auto p-6 pt-4">
          {tab === 'stats' && <RideStats data={rideStatsFromActivity(activity)} />}
          {tab === 'map' && (
            streams
              ? <RideMapGraph streams={streams} />
              : <p className="text-sm text-slate-400">{streamsError ? 'Could not load ride data.' : 'Loading ride…'}</p>
          )}
        </div>
      </div>
    </div>
  )
}
