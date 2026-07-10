const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Formats a sync timestamp relative to now's date, e.g. "today at 14:20",
 * "yesterday at 09:05", "2 Jul at 21:14". Returns '' when syncedAt is null.
 */
export function formatRelativeSyncTime(syncedAt: Date | null, now: Date = new Date()): string {
  if (!syncedAt) return ''
  const timeStr = syncedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const todayStr = now.toISOString().split('T')[0]
  const syncedStr = syncedAt.toISOString().split('T')[0]
  if (syncedStr === todayStr) return `today at ${timeStr}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (syncedStr === yesterday.toISOString().split('T')[0]) return `yesterday at ${timeStr}`
  const [, month, day] = syncedStr.split('-').map(Number)
  return `${day} ${MONTHS_SHORT[month - 1]} at ${timeStr}`
}
