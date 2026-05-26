import type { ICUActivity } from '@/types'

function fmtDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  return `${mins}m`
}

interface Props {
  activity: ICUActivity
}

export default function ActivityCard({ activity }: Props) {
  return (
    <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-sky-500 text-sm font-bold">↑</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-sky-900 truncate">{activity.name}</div>
          <div className="text-xs text-sky-700 mt-0.5 flex gap-2 flex-wrap">
            <span>{fmtDuration(activity.moving_time)}</span>
            {activity.training_load != null && <span>{Math.round(activity.training_load)} TSS</span>}
            {activity.weighted_average_watts != null && <span>{Math.round(activity.weighted_average_watts)}W NP</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
