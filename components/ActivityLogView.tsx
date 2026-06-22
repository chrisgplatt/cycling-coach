'use client'
import { useState, useEffect } from 'react'
import type { ICUActivity } from '@/types'
import ActivityDetailModal from '@/components/ActivityDetailModal'
import AnimatedLogo from '@/components/AnimatedLogo'
import { formatDuration } from '@/components/RideStats'

const ACTIVITY_EMOJI: Record<string, string> = {
  Walk: '🚶', Hike: '🥾', Run: '🏃', VirtualRun: '🏃',
  WeightTraining: '🏋️', Yoga: '🧘', Swim: '🏊',
  Rowing: '🚣', Kayaking: '🛶',
}

function activityEmoji(type: string): string {
  return ACTIVITY_EMOJI[type] ?? '🚴'
}

function formatActivityDate(iso: string): string {
  const d = new Date(iso)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

interface ActivitiesResponse {
  activities: ICUActivity[]
  hasMore: boolean
  total: number
  error?: string
}

function ActivityRow({ activity, onClick }: { activity: ICUActivity; onClick: () => void }) {
  const distKm = activity.distance != null ? (activity.distance / 1000).toFixed(1) : null
  const elevM = activity.total_elevation_gain != null ? Math.round(activity.total_elevation_gain) : null
  const np = activity.weighted_average_watts

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 active:bg-gray-100 min-h-[56px]"
    >
      <span className="text-xl mt-0.5 shrink-0">{activityEmoji(activity.type)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900 truncate">{activity.name || activity.type}</p>
          <div className="text-right shrink-0">
            {distKm && <p className="text-sm font-semibold text-blue-600">{distKm}</p>}
            {elevM != null && elevM > 0 && <p className="text-xs text-emerald-600">↑ {elevM}m</p>}
          </div>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p className="text-xs text-gray-400">{formatActivityDate(activity.start_date_local)}</p>
          <div className="flex gap-2 text-xs text-gray-500">
            <span>{formatDuration(activity.moving_time)}</span>
            {np != null && <span>· NP {np}w</span>}
          </div>
        </div>
      </div>
    </button>
  )
}

export default function ActivityLogView(): JSX.Element {
  const [activities, setActivities] = useState<ICUActivity[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ICUActivity | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch('/api/activities?page=1')
      .then(r => r.json())
      .then((d: ActivitiesResponse) => {
        if (d.error) throw new Error(d.error)
        setActivities(d.activities)
        setHasMore(d.hasMore)
        setPage(1)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function loadMore() {
    const nextPage = page + 1
    setLoadingMore(true)
    fetch(`/api/activities?page=${nextPage}`)
      .then(r => r.json())
      .then((d: ActivitiesResponse) => {
        if (d.error) throw new Error(d.error)
        setActivities(prev => [...prev, ...d.activities])
        setHasMore(d.hasMore)
        setPage(nextPage)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMore(false))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <AnimatedLogo size={48} />
      </div>
    )
  }

  if (error) return <p className="text-sm text-red-600 p-4">{error}</p>

  if (!activities.length) return <p className="text-sm text-gray-400 p-4">No activities found.</p>

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {activities.map(a => (
          <ActivityRow key={a.id} activity={a} onClick={() => setSelected(a)} />
        ))}
        {hasMore && (
          <div className="px-4 py-3 border-t border-gray-100">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full py-2.5 text-sm font-semibold text-blue-600 disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
      {selected && (
        <ActivityDetailModal activity={selected} onClose={() => setSelected(null)} />
      )}
    </>
  )
}
