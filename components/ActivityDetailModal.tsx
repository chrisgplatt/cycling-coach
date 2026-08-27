'use client'
import { useEffect, useState } from 'react'
import type { ICUActivity, RideStreams, SessionDistributions } from '@/types'
import RideStats, { rideStatsFromActivity } from './RideStats'
import RideMapGraph from './ride/RideMapGraph'
import SessionHistogram from './SessionHistogram'
import TabBar from './TabBar'
import { buildHighlightList, type RideHighlight } from '@/lib/ride-highlights'

interface Props {
  activity: ICUActivity
  onClose: () => void
  effectiveMaxHr?: number | null
}

export default function ActivityDetailModal({ activity, onClose, effectiveMaxHr }: Props) {
  const date = new Date(activity.start_date_local)
  const dateStr = date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })

  const [tab, setTab] = useState<'stats' | 'map'>('stats')
  const [streams, setStreams] = useState<RideStreams | null>(null)
  const [streamsError, setStreamsError] = useState(false)
  const [distributions, setDistributions] = useState<SessionDistributions | null>(null)
  const [bestEfforts, setBestEfforts] = useState<Array<{ secs: number; watts: number }> | null>(null)
  const [highlights, setHighlights] = useState<RideHighlight[]>([])

  // Distributions and best-effort power live on the linked workout row (keyed by
  // activity id); fetch them so the Stats tab can show the histogram and the
  // 5s/15s/60min best-power cells ICUActivity itself doesn't carry. Both are null
  // when the ride has no enriched row.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/rides/activity/${activity.id}/distributions`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return
        setDistributions(d.distributions ?? null)
        setBestEfforts(d.bestEfforts ?? null)
      })
      .catch(() => { /* no histogram/best-power if it can't be loaded */ })
    return () => { cancelled = true }
  }, [activity.id])

  // Ride highlights (climbs, effort periods, sprints, personal bests) live on
  // the same linked workout row as distributions; fetched separately since
  // they're a distinct concern with their own route, matching this file's
  // existing per-concern fetch convention. Fed into the Map tab's RideMapGraph
  // as markers/cards rather than a dedicated tab.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/rides/activity/${activity.id}/highlights`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setHighlights(buildHighlightList(d)) })
      .catch(() => { /* no highlights if they can't be loaded */ })
    return () => { cancelled = true }
  }, [activity.id])

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
    <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white shadow-xl w-full h-full flex flex-col sm:max-w-md sm:h-[90vh] sm:rounded-2xl">
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

        {tab === 'map' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {streams
              ? <RideMapGraph streams={streams} highlights={highlights} fit />
              : <p className="p-6 text-sm text-slate-400">{streamsError ? 'Could not load ride data.' : 'Loading ride…'}</p>}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-6 pt-4 space-y-4">
            <RideStats data={rideStatsFromActivity(activity, bestEfforts)} effectiveMaxHr={effectiveMaxHr} />
            <SessionHistogram distributions={distributions} />
          </div>
        )}
      </div>
    </div>
  )
}
