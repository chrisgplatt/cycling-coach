import type { RideMedals, MedalEntry } from '@/lib/ride/ride-medals'
import type { BestCategory } from '@/lib/ride/best-records'

const CATEGORY_ICON: Record<BestCategory, string> = {
  biggest_climb: '🏔️',
  longest_climb: '📏',
  power: '⚡',
  speed: '🚀',
  max_speed: '💥',
}

const CATEGORY_LABEL: Record<BestCategory, string> = {
  biggest_climb: 'Biggest climb',
  longest_climb: 'Longest climb',
  power: 'Power',
  speed: 'Speed',
  max_speed: 'Max speed',
}

// power's subKey is a duration in seconds; speed's is a distance in km. Climbs
// and max_speed carry no subKey ('') and need no detail suffix.
function formatSubKey(category: BestCategory, subKey: string): string {
  if (!subKey) return ''
  if (category === 'power') {
    const secs = Number(subKey)
    return secs < 60 ? `${secs}s` : `${secs / 60} min`
  }
  if (category === 'speed') return `${subKey} km`
  return ''
}

function categoryDetail(entry: MedalEntry): string {
  const detail = formatSubKey(entry.category, entry.subKey)
  return detail ? `${CATEGORY_LABEL[entry.category]} ${detail}` : CATEGORY_LABEL[entry.category]
}

// The card badge is presence-only per tier, not per category — a ride holding
// both an all-time #1 climb and an all-time #3 power record still shows a
// single trophy, picking the best (lowest-numbered) rank across every entry
// in that tier.
function bestRank(entries: MedalEntry[]): number | null {
  if (entries.length === 0) return null
  return Math.min(...entries.map(e => e.rank))
}

function TierIcon({ icon, label, rank }: { icon: string; label: string; rank: number }) {
  return (
    <span title={label} aria-label={label}>
      {icon}{rank > 1 ? ` ${rank}` : ''}
    </span>
  )
}

export function RideMedalIcons({ medals }: { medals: RideMedals | null | undefined }) {
  if (!medals) return null
  const allTimeRank = bestRank(medals.allTime)
  const yearRank = bestRank(medals.year)
  if (allTimeRank == null && yearRank == null) return null
  return (
    <span className="inline-flex items-center gap-1">
      {allTimeRank != null && <TierIcon icon="🏆" label="All-time record" rank={allTimeRank} />}
      {yearRank != null && <TierIcon icon="🥇" label="Year-best record" rank={yearRank} />}
    </span>
  )
}

function MedalRow({ tierIcon, tierLabel, entry }: { tierIcon: string; tierLabel: string; entry: MedalEntry }) {
  const rankSuffix = entry.rank > 1 ? ` #${entry.rank}` : ''
  return (
    <div className="flex items-center gap-2 text-sm text-gray-700">
      <span aria-hidden="true">{tierIcon}</span>
      <span aria-hidden="true">{CATEGORY_ICON[entry.category]}</span>
      <span>{tierLabel}{rankSuffix} · {categoryDetail(entry)}</span>
    </div>
  )
}

export function RideMedalList({ medals, year }: { medals: RideMedals | null | undefined; year: string }) {
  if (!medals) return null
  if (medals.allTime.length === 0 && medals.year.length === 0) return null
  return (
    <div className="space-y-1">
      {medals.allTime.map((entry, i) => (
        <MedalRow key={`all-${i}`} tierIcon="🏆" tierLabel="All-time" entry={entry} />
      ))}
      {medals.year.map((entry, i) => (
        <MedalRow key={`year-${i}`} tierIcon="🥇" tierLabel={`${year} best`} entry={entry} />
      ))}
    </div>
  )
}
