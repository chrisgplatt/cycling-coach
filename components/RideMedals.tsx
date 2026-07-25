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

export function RideMedalIcons({ medals }: { medals: RideMedals | null | undefined }) {
  if (!medals) return null
  const hasAllTime = medals.allTime.length > 0
  const hasYear = medals.year.length > 0
  if (!hasAllTime && !hasYear) return null
  return (
    <span className="inline-flex items-center gap-1">
      {hasAllTime && <span title="All-time record" aria-label="All-time record">🏆</span>}
      {hasYear && <span title="Year-best record" aria-label="Year-best record">🥇</span>}
    </span>
  )
}

function MedalRow({ tierIcon, tierLabel, entry }: { tierIcon: string; tierLabel: string; entry: MedalEntry }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-700">
      <span aria-hidden="true">{tierIcon}</span>
      <span aria-hidden="true">{CATEGORY_ICON[entry.category]}</span>
      <span>{tierLabel} · {CATEGORY_LABEL[entry.category]}</span>
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
