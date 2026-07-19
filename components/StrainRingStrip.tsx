'use client'
import { useState } from 'react'
import MetricRing from '@/components/MetricRing'
import StrainBreakdownSheet from '@/components/StrainBreakdownSheet'
import RecoveryBreakdownModal from '@/components/RecoveryBreakdownModal'
import SleepBreakdownModal from '@/components/SleepBreakdownModal'
import { strainLabel, computeStrainTarget } from '@/lib/strain'
import type { RecoveryScore } from '@/lib/recovery-score'
import type { ICUWellness, DailyStrainPoint } from '@/types'

interface ActivityInput {
  name: string
  durationMin: number
  avgHr: number | null
  trainingLoad: number | null
}

interface Props {
  recovery: RecoveryScore
  strainToday: DailyStrainPoint | null
  wellness: ICUWellness
  activities: ActivityInput[]
  maxHr: number | null
  restingHr: number | null
}

type ThreeBand = 'high' | 'moderate' | 'low'

const THREE_BAND_COLOR: Record<ThreeBand, string> = {
  high: '#059669', moderate: '#d97706', low: '#dc2626',
}
const STRAIN_COLOR: Record<string, string> = {
  light: '#059669', moderate: '#d97706', high: '#f97316', all_out: '#dc2626',
}

function sleepBand(score: number): ThreeBand {
  if (score >= 75) return 'high'
  if (score >= 50) return 'moderate'
  return 'low'
}

function titleCase(s: string): string {
  return s === 'all_out' ? 'All Out' : s.charAt(0).toUpperCase() + s.slice(1)
}

export default function StrainRingStrip({ recovery, strainToday, wellness, activities, maxHr, restingHr }: Props) {
  const [open, setOpen] = useState<'recovery' | 'strain' | 'sleep' | null>(null)

  const strainScore = strainToday?.workoutStrain ?? null
  const strainCategory = strainScore != null ? strainLabel(strainScore) : null
  const sleepScore = wellness.sleep_score
  const sleepBandKey = sleepScore != null ? sleepBand(sleepScore) : null

  const strainTarget = computeStrainTarget(recovery.score)
  const targetLowPct = (strainTarget.low / 21) * 100
  const targetHighPct = (strainTarget.high / 21) * 100

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex justify-between gap-2">
          <MetricRing
            displayValue={String(recovery.score)}
            pct={recovery.score}
            label="Recovery"
            bandLabel={titleCase(recovery.band)}
            color={THREE_BAND_COLOR[recovery.band]}
            onTap={() => setOpen('recovery')}
          />
          <MetricRing
            displayValue={strainScore != null ? String(strainScore) : '—'}
            pct={strainScore != null ? (strainScore / 21) * 100 : 0}
            label="Strain"
            bandLabel={strainCategory ? titleCase(strainCategory) : '—'}
            color={strainCategory ? STRAIN_COLOR[strainCategory] : '#9ca3af'}
            onTap={strainToday ? () => setOpen('strain') : undefined}
            targetLowPct={targetLowPct}
            targetHighPct={targetHighPct}
          />
          <MetricRing
            displayValue={sleepScore != null ? String(sleepScore) : '—'}
            pct={sleepScore ?? 0}
            label="Sleep"
            bandLabel={sleepBandKey ? titleCase(sleepBandKey) : '—'}
            color={sleepBandKey ? THREE_BAND_COLOR[sleepBandKey] : '#9ca3af'}
            onTap={() => setOpen('sleep')}
          />
        </div>
      </div>

      {open === 'recovery' && <RecoveryBreakdownModal recovery={recovery} onClose={() => setOpen(null)} />}
      {open === 'strain' && strainToday && (
        <StrainBreakdownSheet
          strainToday={strainToday}
          activities={activities}
          maxHr={maxHr}
          restingHr={restingHr}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'sleep' && <SleepBreakdownModal wellness={wellness} onClose={() => setOpen(null)} />}
    </>
  )
}
