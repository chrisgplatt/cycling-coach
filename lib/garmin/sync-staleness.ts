import { localDateStr } from '@/lib/local-date'

/**
 * Stale means: never synced, or the last sync was before today's calendar
 * date and it's already past 7am local time (avoids a false alarm at 6am,
 * before a normal morning sync would have happened). A future-dated sync
 * (clock skew) is treated as fresh, not stale.
 */
export function isGarminSyncStale(lastSyncAt: string | null, now: Date = new Date()): boolean {
  if (lastSyncAt === null) return true
  const lastSyncDate = localDateStr(new Date(lastSyncAt))
  const todayStr = localDateStr(now)
  if (lastSyncDate >= todayStr) return false
  return now.getHours() >= 7
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Formats an ISO timestamp as e.g. "Thu 2 Jul, 10:14pm" in local time. */
export function formatGarminSyncTime(iso: string): string {
  const d = new Date(iso)
  const hours24 = d.getHours()
  const period = hours24 >= 12 ? 'pm' : 'am'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hours12}:${mins}${period}`
}
