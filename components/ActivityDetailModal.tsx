'use client'
import Link from 'next/link'
import type { ICUActivity } from '@/types'

function fmtDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  return `${mins}m`
}

interface Props {
  activity: ICUActivity
  onClose: () => void
}

export default function ActivityDetailModal({ activity, onClose }: Props) {
  const date = new Date(activity.start_date_local)
  const dateStr = date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })

  const stats: Array<{ label: string; value: string }> = [
    { label: 'Duration', value: fmtDuration(activity.moving_time) },
  ]
  if (activity.distance != null) stats.push({ label: 'Distance', value: `${(activity.distance / 1000).toFixed(1)} km` })
  if (activity.total_elevation_gain != null) stats.push({ label: 'Elevation', value: `${Math.round(activity.total_elevation_gain)} m` })
  if (activity.training_load != null) stats.push({ label: 'TSS', value: String(Math.round(activity.training_load)) })
  if (activity.weighted_average_watts != null) stats.push({ label: 'NP', value: `${Math.round(activity.weighted_average_watts)} W` })
  if (activity.average_heartrate != null) stats.push({ label: 'Avg HR', value: `${Math.round(activity.average_heartrate)} bpm` })

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
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

        <div className="grid grid-cols-3 gap-2.5">
          {stats.map(s => (
            <div key={s.label} className="bg-slate-50 rounded-lg px-2 py-2 text-center">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{s.label}</div>
              <div className="text-sm font-bold text-slate-800 mt-0.5">{s.value}</div>
            </div>
          ))}
        </div>

        <Link
          href={`/ride/activity/${activity.id}`}
          className="flex items-center justify-center w-full bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-blue-700 transition-colors min-h-[44px]"
        >
          View ride map →
        </Link>
      </div>
    </div>
  )
}
