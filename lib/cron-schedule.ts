// The daily-briefing cron only runs at these fixed UTC hours (see vercel.json).
// isNotificationTime() in app/api/cron/daily-briefing/route.ts matches on local
// hour only, so these are the only notification times a user can actually receive.
export const CRON_UTC_HOURS = [6, 7]

// Converts the fixed cron UTC hours into local HH:MM strings for a given IANA
// timezone, accounting for DST on the current date — mirrors the UTC-to-local
// conversion isNotificationTime() does in reverse when matching a cron run.
export function notificationTimeOptions(timezone: string): string[] {
  const now = new Date()
  return CRON_UTC_HOURS.map(utcHour => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, 0, 0))
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const hh = parts.find(p => p.type === 'hour')?.value ?? '00'
    const mm = parts.find(p => p.type === 'minute')?.value ?? '00'
    return `${hh}:${mm}`
  })
}
