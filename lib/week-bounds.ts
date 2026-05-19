export function getWeekBounds(date: string): { start: string; end: string } {
  const d = new Date(date)                    // YYYY-MM-DD parses as UTC midnight
  const day = d.getUTCDay()                   // 0=Sun, 1=Mon, …, 6=Sat
  const offset = day === 0 ? 6 : day - 1     // days since Monday
  const mon = new Date(d)
  mon.setUTCDate(d.getUTCDate() - offset)
  const sun = new Date(mon)
  sun.setUTCDate(mon.getUTCDate() + 6)
  return {
    start: mon.toISOString().split('T')[0],
    end: sun.toISOString().split('T')[0],
  }
}
