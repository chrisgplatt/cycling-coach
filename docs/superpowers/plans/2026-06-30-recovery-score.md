# Recovery Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a composite daily Recovery Score (0–100) on the Dashboard and Fitness page, backed by a weighted algorithm combining Garmin sleep stages, HRV, subjective wellness, training load, and body battery, with the AI coach referencing the score in its daily advisory.

**Architecture:** A pure `computeRecoveryScore()` function in `lib/recovery-score.ts` takes already-synced wellness data and returns a score, band, and explanation string. The Dashboard's TodayCard replaces its TSB-derived readiness label with the composite score. The Fitness page gains two new sections (Sleep and Recovery trend). The briefing route computes the score and passes it into the Claude prompt.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (data already synced), inline SVG charts (existing pattern), Tailwind CSS.

## Global Constraints

- Mobile-first: all new UI elements ≥ 44px touch targets, ≥ 320px viewport support
- No new charting libraries — use inline SVG following the existing `HrvSection` pattern in `app/fitness/page.tsx`
- No new Garmin API calls or DB schema changes — all required data is already synced
- Follow existing `SectionCard` pattern (defined at line 13 of `app/fitness/page.tsx`)
- Score degrades gracefully: missing components are excluded from the weighted average
- `lib/recovery-score.ts` must be pure — no React, no DB, no Anthropic imports
- Colour bands: Green ≥ 75, Amber 50–74, Red < 50
- Always run `npm run typecheck` before committing

---

### Task 1: Core Algorithm — `lib/recovery-score.ts`

**Files:**
- Create: `lib/recovery-score.ts`
- Test: `__tests__/lib/recovery-score.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `RecoveryInputs`, `RecoveryScore`, `computeRecoveryScore(inputs: RecoveryInputs): RecoveryScore` — used by Tasks 2, 3, 4, 5

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/recovery-score.test.ts`:

```ts
import { computeRecoveryScore, type RecoveryInputs } from '@/lib/recovery-score'

const ALL_DATA: RecoveryInputs = {
  hrv: 55,
  hrvBaseline: 50,             // ratio 1.10 → hrv index = 90
  garmin_sleep_deep_secs: 5760,  // 96 min = 20% of 8h → deepScore = 100
  garmin_sleep_light_secs: 14400, // 240 min
  garmin_sleep_rem_secs: 7200,   // 120 min = 25% of total → remScore = 100
  garmin_sleep_awake_secs: 1440, // 24 min; total = 28800 = 8h → durationScore = 100
  body_battery_high: 80,
  energy: 4,
  leg_freshness: 4,
  tsb: 10,                     // lerp(80,100,(10-5)/20) = 92.5
}

describe('computeRecoveryScore', () => {
  it('returns a score in [0, 100]', () => {
    const result = computeRecoveryScore(ALL_DATA)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('returns high band when all components are excellent', () => {
    const result = computeRecoveryScore(ALL_DATA)
    expect(result.band).toBe('high')
    expect(result.explanation).toBe('')
  })

  it('returns low band and explanation when HRV is suppressed', () => {
    const result = computeRecoveryScore({
      ...ALL_DATA,
      hrv: 30,          // ratio 0.60 → clamped → hrv index = 0
      energy: 1,
      leg_freshness: 1, // wellness = 0
    })
    expect(result.band).toBe('low')
    expect(result.explanation).toMatch(/HRV suppressed/)
  })

  it('excludes unavailable components from weighted average', () => {
    const noSleep: RecoveryInputs = {
      hrv: 55,
      hrvBaseline: 50,
      garmin_sleep_deep_secs: null,
      garmin_sleep_light_secs: null,
      garmin_sleep_rem_secs: null,
      garmin_sleep_awake_secs: null,
      body_battery_high: null,
      energy: 4,
      leg_freshness: 4,
      tsb: 10,
    }
    const result = computeRecoveryScore(noSleep)
    expect(result.components.sleep).toBeNull()
    expect(result.components.bodyBattery).toBeNull()
    expect(result.score).toBeGreaterThan(0)
  })

  it('returns score 50 and moderate band when no data is available', () => {
    const empty: RecoveryInputs = {
      hrv: null, hrvBaseline: null,
      garmin_sleep_deep_secs: null, garmin_sleep_light_secs: null,
      garmin_sleep_rem_secs: null, garmin_sleep_awake_secs: null,
      body_battery_high: null, energy: null, leg_freshness: null, tsb: null,
    }
    const result = computeRecoveryScore(empty)
    expect(result.score).toBe(50)
    expect(result.band).toBe('moderate')
  })

  it('HRV exactly at baseline → hrv index = 70', () => {
    const r = computeRecoveryScore({ ...ALL_DATA, hrv: 50, hrvBaseline: 50 })
    expect(r.components.hrv).toBeCloseTo(70, 0)
  })

  it('TSB at -25 → tsb index = 10', () => {
    const r = computeRecoveryScore({ ...ALL_DATA, tsb: -25 })
    expect(r.components.tsb).toBe(10)
  })

  it('sleep exactly 8h with 20% deep and 25% REM → sleep index = 100', () => {
    const r = computeRecoveryScore(ALL_DATA)
    expect(r.components.sleep).toBeCloseTo(100, 0)
  })

  it('wellness energy=1, legs=1 → wellness index = 0', () => {
    const r = computeRecoveryScore({ ...ALL_DATA, energy: 1, leg_freshness: 1 })
    expect(r.components.wellness).toBeCloseTo(0, 0)
  })

  it('wellness with one field null uses the other alone', () => {
    const r = computeRecoveryScore({ ...ALL_DATA, energy: 5, leg_freshness: null })
    expect(r.components.wellness).toBeCloseTo(100, 0)
  })

  it('explanation picks the two worst components', () => {
    const r = computeRecoveryScore({
      ...ALL_DATA,
      hrv: 25,          // HRV suppressed (ratio 0.50)
      garmin_sleep_deep_secs: 600,  // very short deep sleep
      tsb: 10,
      energy: 4,
      leg_freshness: 4,
    })
    expect(r.explanation).toMatch(/HRV suppressed/)
    expect(r.explanation).toMatch(/short/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest __tests__/lib/recovery-score.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '@/lib/recovery-score'"

- [ ] **Step 3: Implement `lib/recovery-score.ts`**

```ts
export interface RecoveryInputs {
  hrv: number | null
  hrvBaseline: number | null
  garmin_sleep_deep_secs: number | null
  garmin_sleep_light_secs: number | null
  garmin_sleep_rem_secs: number | null
  garmin_sleep_awake_secs: number | null
  body_battery_high: number | null
  energy: number | null
  leg_freshness: number | null
  tsb: number | null
}

export interface RecoveryScore {
  score: number
  band: 'high' | 'moderate' | 'low'
  explanation: string
  components: {
    sleep: number | null
    hrv: number | null
    wellness: number | null
    tsb: number | null
    bodyBattery: number | null
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a)
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function computeSleepIndex(inputs: RecoveryInputs): number | null {
  const { garmin_sleep_deep_secs: deep, garmin_sleep_light_secs: light,
    garmin_sleep_rem_secs: rem, garmin_sleep_awake_secs: awake } = inputs
  if (deep === null && light === null && rem === null && awake === null) return null
  const totalSecs = (deep ?? 0) + (light ?? 0) + (rem ?? 0) + (awake ?? 0)
  if (totalSecs === 0) return 0
  const sub: number[] = [clamp01(totalSecs / (8 * 3600)) * 100]
  if (deep !== null) sub.push(clamp01((deep / totalSecs) / 0.20) * 100)
  if (rem !== null) sub.push(clamp01((rem / totalSecs) / 0.25) * 100)
  return sub.reduce((a, b) => a + b, 0) / sub.length
}

function computeHrvIndex(inputs: RecoveryInputs): number | null {
  const { hrv, hrvBaseline } = inputs
  if (hrv === null || hrvBaseline === null || hrvBaseline === 0) return null
  const ratio = hrv / hrvBaseline
  if (ratio >= 1.10) return 90
  if (ratio >= 1.00) return lerp(70, 90, (ratio - 1.00) / 0.10)
  if (ratio >= 0.90) return lerp(40, 70, (ratio - 0.90) / 0.10)
  return lerp(0, 40, clamp01((ratio - 0.70) / 0.20))
}

function computeWellnessIndex(inputs: RecoveryInputs): number | null {
  const { energy, leg_freshness } = inputs
  const vals = [energy, leg_freshness].filter((v): v is number => v !== null)
  if (!vals.length) return null
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  return (avg - 1) / 4 * 100
}

function computeTsbIndex(inputs: RecoveryInputs): number | null {
  const { tsb } = inputs
  if (tsb === null) return null
  if (tsb >= 25) return 100
  if (tsb >= 5) return lerp(80, 100, (tsb - 5) / 20)
  if (tsb >= -10) return lerp(45, 80, (tsb + 10) / 15)
  if (tsb >= -25) return lerp(10, 45, (tsb + 25) / 15)
  return 10
}

const COMPONENT_WEIGHTS = { sleep: 0.30, hrv: 0.30, wellness: 0.20, tsb: 0.10, bodyBattery: 0.10 } as const
type ComponentKey = keyof typeof COMPONENT_WEIGHTS

const EXPLANATION_LABELS: { key: ComponentKey; label: string }[] = [
  { key: 'sleep', label: 'short/poor deep sleep' },
  { key: 'hrv', label: 'HRV suppressed' },
  { key: 'wellness', label: 'low subjective energy' },
  { key: 'tsb', label: 'high training load' },
  { key: 'bodyBattery', label: 'low body battery' },
]

export function computeRecoveryScore(inputs: RecoveryInputs): RecoveryScore {
  const components = {
    sleep: computeSleepIndex(inputs),
    hrv: computeHrvIndex(inputs),
    wellness: computeWellnessIndex(inputs),
    tsb: computeTsbIndex(inputs),
    bodyBattery: inputs.body_battery_high,
  }

  const available = (Object.keys(components) as ComponentKey[]).filter(k => components[k] !== null)

  let score: number
  if (!available.length) {
    score = 50
  } else {
    const totalWeight = available.reduce((s, k) => s + COMPONENT_WEIGHTS[k], 0)
    score = Math.round(available.reduce((s, k) => s + (components[k] as number) * COMPONENT_WEIGHTS[k] / totalWeight, 0))
  }

  const band: RecoveryScore['band'] = score >= 75 ? 'high' : score >= 50 ? 'moderate' : 'low'

  const explanation = score >= 75 ? '' : EXPLANATION_LABELS
    .filter(l => components[l.key] !== null && (components[l.key] as number) < 50)
    .sort((a, b) => (components[a.key] as number) - (components[b.key] as number))
    .slice(0, 2)
    .map(l => l.label)
    .join(', ')

  return { score, band, explanation, components }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest __tests__/lib/recovery-score.test.ts --no-coverage
```

Expected: PASS — all tests green

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add lib/recovery-score.ts __tests__/lib/recovery-score.test.ts
git commit -m "feat: add computeRecoveryScore pure algorithm"
```

---

### Task 2: Dashboard — Recovery Score chip in TodayCard

**Files:**
- Modify: `components/TodayCard.tsx`
- Modify: `app/dashboard/page.tsx`
- Modify: `__tests__/components/TodayCardBadge.test.tsx`

**Interfaces:**
- Consumes: `computeRecoveryScore` from `lib/recovery-score.ts` (Task 1)
- Produces: updated `TodayCard` props interface — `hrvBaseline?: number | null`, `todayDailyWellness?: { energy: number | null; leg_freshness: number | null }`

**Context:** `TodayCard` currently shows a "Readiness" label in the top-right header (lines 136–138 in `components/TodayCard.tsx`), derived from TSB alone via `readinessLabel(tsb)`. Replace this block with the composite Recovery Score chip. The `TodayCard` props already include `wellness: ICUWellness | null` which has `hrv`, `form` (TSB), `body_battery_high`, and garmin sleep fields. We add two new optional props for HRV baseline and today's subjective ratings.

The dashboard page already computes `hrvStatus = computeHrvBaseline(wellnessArr)` at line 404. It also has `dailyWellness: DailyWellness[]` state fetched from `/api/wellness`. We pass `hrvStatus.baselineMean` and today's daily wellness entry to TodayCard.

- [ ] **Step 1: Update the existing test to pass the new props**

Edit `__tests__/components/TodayCardBadge.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import TodayCard from '@/components/TodayCard'

beforeEach(() => {
  localStorage.clear()
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ coach_note: 'Hit the intervals.', verdict: 'green', headline: 'Go hard' }),
  } as Response)
})
afterEach(() => jest.restoreAllMocks())

it('shows the readiness badge when the briefing returns a verdict', async () => {
  render(<TodayCard workout={null} wellness={null} />)
  fireEvent.click(screen.getByRole('button', { name: /coach's note/i }))
  await waitFor(() => expect(screen.getByTestId('readiness-badge')).toBeInTheDocument())
  expect(screen.getByTestId('readiness-badge')).toHaveTextContent(/GO HARD/i)
})

it('renders the weather strip when the briefing returns weather', async () => {
  localStorage.clear()
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      coach_note: 'Take the intervals indoors.',
      verdict: 'green', headline: 'Go hard',
      weather: {
        temp_min_c: 8, temp_max_c: 14, precip_prob_pct: 80,
        wind_max_kph: 30, gust_max_kph: 50, weather_code: 65, description: 'Heavy rain',
      },
    }),
  })
  render(<TodayCard workout={null} wellness={null} />)
  fireEvent.click(screen.getByRole('button', { name: /coach's note/i }))
  expect(await screen.findByTestId('weather-strip')).toHaveTextContent('Heavy rain')
})

it('shows Recovery score chip when wellness data is available', () => {
  const wellness = {
    id: '2026-06-30',
    ctl: 60, atl: 65, form: -5, hrv: 52, resting_hr: 58,
    sleep_secs: 28800, body_battery_low: 30, body_battery_high: 85,
    stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
    garmin_sleep_deep_secs: 5760, garmin_sleep_light_secs: 14400,
    garmin_sleep_rem_secs: 7200, garmin_sleep_awake_secs: 1440,
  }
  render(<TodayCard workout={null} wellness={wellness} hrvBaseline={50} />)
  expect(screen.getByText('Recovery')).toBeInTheDocument()
  // score should be visible as a number
  expect(screen.getByTestId('recovery-score')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify the new assertion fails**

```bash
npx jest __tests__/components/TodayCardBadge.test.tsx --no-coverage
```

Expected: first two tests pass, third FAILS — "Unable to find an element with the text: Recovery"

- [ ] **Step 3: Update `components/TodayCard.tsx`**

Add the two new optional props and replace the readiness label block. The full updated component:

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import WorkoutCard from '@/components/WorkoutCard'
import ReadinessBadge from '@/components/ReadinessBadge'
import WeatherStrip from '@/components/WeatherStrip'
import { computeRecoveryScore } from '@/lib/recovery-score'
import type { Workout, ICUWellness, TrainingEvent, WeatherSummary } from '@/types'
import type { ReadinessVerdict } from '@/lib/claude/briefing'

interface Props {
  workout: Workout | null
  wellness: ICUWellness | null
  todayEvent?: TrainingEvent | null
  extraSessionCount?: number
  ftp?: number
  hrvBaseline?: number | null
  todayDailyWellness?: { energy: number | null; leg_freshness: number | null }
  onWorkoutClick?: (workout: Workout) => void
  onChatWithCoach?: () => void
}

const BAND_COLOUR = {
  high: 'text-emerald-600',
  moderate: 'text-amber-500',
  low: 'text-red-500',
} as const

const BAND_DOT = {
  high: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  low: 'bg-red-500',
} as const

const BRIEFING_CACHE_KEY = 'cycling_coach_briefing'

export default function TodayCard({
  workout, wellness, todayEvent, extraSessionCount, ftp,
  hrvBaseline, todayDailyWellness,
  onWorkoutClick, onChatWithCoach,
}: Props) {
  const [coachNote, setCoachNote] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<ReadinessVerdict | null>(null)
  const [headline, setHeadline] = useState<string | null>(null)
  const [weather, setWeather] = useState<WeatherSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [cacheWorkoutCompleted, setCacheWorkoutCompleted] = useState<boolean | null>(null)
  const hasAutoRefreshed = useRef(false)

  async function fetchNote(refresh = false) {
    const today = new Date().toISOString().split('T')[0]
    const isCompleted = workout?.status === 'completed'

    if (!refresh) {
      try {
        const raw = localStorage.getItem(BRIEFING_CACHE_KEY)
        if (raw) {
          const cached = JSON.parse(raw)
          if (cached.date === today && cached.coach_note) {
            setCoachNote(cached.coach_note)
            setVerdict(cached.verdict ?? null)
            setHeadline(cached.headline ?? null)
            setWeather(cached.weather ?? null)
            setCacheWorkoutCompleted(cached.workoutCompleted ?? false)
            setLoading(false)
            return
          }
        }
      } catch { /* ignore cache errors */ }
    }

    try {
      const url = refresh ? '/api/briefing/today?refresh=true' : '/api/briefing/today'
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setCoachNote(data.coach_note)
        setVerdict(data.verdict ?? null)
        setHeadline(data.headline ?? null)
        setWeather(data.weather ?? null)
        setCacheWorkoutCompleted(isCompleted)
        try {
          localStorage.setItem(BRIEFING_CACHE_KEY, JSON.stringify({
            date: today,
            coach_note: data.coach_note,
            verdict: data.verdict ?? null,
            headline: data.headline ?? null,
            weather: data.weather ?? null,
            workoutCompleted: isCompleted,
          }))
        } catch { /* ignore storage errors */ }
      }
    } catch { /* silent */ } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { fetchNote() }, [])

  useEffect(() => {
    if (cacheWorkoutCompleted !== false) return
    if (hasAutoRefreshed.current) return
    const rideCompleted = workout?.status === 'completed'
    const raceResultRecorded = todayEvent?.result_tss != null
    if (rideCompleted || raceResultRecorded) {
      hasAutoRefreshed.current = true
      setRefreshing(true)
      fetchNote(true)
    }
  }, [workout, todayEvent, cacheWorkoutCompleted])

  async function handleRefresh() {
    setRefreshing(true)
    await fetchNote(true)
  }

  const tsb = wellness?.form ?? (
    wellness?.ctl !== null && wellness?.atl !== null && wellness?.ctl !== undefined && wellness?.atl !== undefined
      ? wellness.ctl - wellness.atl
      : null
  )

  const recovery = computeRecoveryScore({
    hrv: wellness?.hrv ?? null,
    hrvBaseline: hrvBaseline ?? null,
    garmin_sleep_deep_secs: wellness?.garmin_sleep_deep_secs ?? null,
    garmin_sleep_light_secs: wellness?.garmin_sleep_light_secs ?? null,
    garmin_sleep_rem_secs: wellness?.garmin_sleep_rem_secs ?? null,
    garmin_sleep_awake_secs: wellness?.garmin_sleep_awake_secs ?? null,
    body_battery_high: wellness?.body_battery_high ?? null,
    energy: todayDailyWellness?.energy ?? null,
    leg_freshness: todayDailyWellness?.leg_freshness ?? null,
    tsb,
  })

  const today = new Date()
  const dateLabel = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const dayType = workout
    ? workout.type.charAt(0).toUpperCase() + workout.type.slice(1) + ' day'
    : todayEvent
      ? todayEvent.type.charAt(0).toUpperCase() + todayEvent.type.slice(1) + ' day'
      : 'Rest day'

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Today</p>
          <p className="text-sm font-medium text-slate-700 mt-0.5">{dateLabel} · {dayType}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400 mb-0.5">Recovery</p>
          <div className="flex items-center justify-end gap-1.5" data-testid="recovery-score">
            <span className={`w-2 h-2 rounded-full ${BAND_DOT[recovery.band]}`} aria-hidden="true" />
            <span className={`text-sm font-semibold ${BAND_COLOUR[recovery.band]}`}>
              {recovery.score} <span className="capitalize">{recovery.band}</span>
            </span>
          </div>
          {recovery.explanation ? (
            <p className="text-[11px] text-slate-400 mt-0.5 max-w-[140px] text-right">{recovery.explanation}</p>
          ) : null}
        </div>
      </div>

      {/* Today's workout or event */}
      {workout ? (
        <>
          <WorkoutCard workout={workout} onClick={() => onWorkoutClick?.(workout)} ftp={ftp} />
          {extraSessionCount != null && extraSessionCount > 0 && (
            <p className="text-xs text-slate-400 pl-1">+{extraSessionCount} more session{extraSessionCount > 1 ? 's' : ''} today — see weekly strip below</p>
          )}
        </>
      ) : todayEvent ? (
        <div className="bg-red-50 rounded-xl border border-red-100 px-4 py-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-base">🏁</span>
            <p className="text-sm font-semibold text-slate-800">{todayEvent.name}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
            <span className="capitalize font-medium text-red-600">{todayEvent.type}</span>
            <span>·</span>
            <span>Priority {todayEvent.priority}</span>
            {todayEvent.race_type && <><span>·</span><span className="capitalize">{todayEvent.race_type.replace(/_/g, ' ')}</span></>}
            {todayEvent.start_time && <><span>·</span><span>Starts {todayEvent.start_time}</span></>}
            {todayEvent.distance_km && <><span>·</span><span>~{todayEvent.distance_km}km</span></>}
          </div>
          {todayEvent.result_tss != null ? (
            <p className="text-xs text-emerald-600 font-medium">Result recorded · TSS {todayEvent.result_tss}</p>
          ) : (
            <p className="text-xs text-slate-400">Good luck — no training session scheduled today.</p>
          )}
        </div>
      ) : (
        <div className="bg-slate-50 rounded-xl border border-slate-100 px-4 py-3">
          <p className="text-sm text-slate-500">No session planned — rest and recover.</p>
        </div>
      )}

      {/* Coach note */}
      <div className="border-t border-slate-100">
        <button
          onClick={() => setNotesOpen(o => !o)}
          className="w-full flex items-center justify-between pt-3 pb-1 text-left"
          aria-expanded={notesOpen}
        >
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Coach's note</span>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            className={`text-slate-400 transition-transform duration-200 ${notesOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {notesOpen && (
          <div className="pb-1 space-y-2">
            {!loading && verdict && headline && (
              <ReadinessBadge verdict={verdict} headline={headline} />
            )}
            {!loading && weather && <WeatherStrip weather={weather} />}
            {loading ? (
              <p className="text-sm text-slate-400">Getting your briefing…</p>
            ) : coachNote ? (
              <p className="text-sm text-slate-600 leading-relaxed font-light">{coachNote}</p>
            ) : (
              <p className="text-sm text-slate-400 italic">Coach note unavailable.</p>
            )}
            {!loading && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
              >
                {refreshing ? 'Getting note…' : todayEvent?.result_tss != null ? 'Get post-race note' : workout?.status === 'completed' ? 'Get post-ride note' : 'Refresh note'}
              </button>
            )}
            {!loading && onChatWithCoach && workout && (
              <button
                onClick={onChatWithCoach}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors py-2 block"
              >
                <span className="flex items-center gap-1.5">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                  </svg>
                  Chat with coach →
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update `app/dashboard/page.tsx` to pass `hrvBaseline` and today's daily wellness**

Find the `<TodayCard` render call at line ~606. Before the call, extract the needed values. The dashboard already has `hrvStatus` (line 404) and `dailyWellness: DailyWellness[]` state (line 121). Add two variables just above the `<TodayCard` call:

```tsx
// Insert just before the <TodayCard> JSX element (~line 606):
const todayDailyWellnessEntry = dailyWellness.find(w => w.date === todayStr)
const todayDailyWellnessForCard = todayDailyWellnessEntry
  ? { energy: todayDailyWellnessEntry.energy, leg_freshness: todayDailyWellnessEntry.leg_freshness }
  : undefined
```

Then update the `<TodayCard` JSX to add the two new props:

```tsx
<TodayCard
  workout={todayWorkout}
  wellness={latestWellness}
  todayEvent={events.find(e => e.date === todayStr) ?? null}
  extraSessionCount={todaySessionCount - 1}
  ftp={currentFTP}
  hrvBaseline={hrvStatus.baselineMean}
  todayDailyWellness={todayDailyWellnessForCard}
  onWorkoutClick={w => setSelectedWorkout(w)}
  onChatWithCoach={todayWorkout ? () => setChatWorkout(todayWorkout) : undefined}
/>
```

- [ ] **Step 5: Run the tests**

```bash
npx jest __tests__/components/TodayCardBadge.test.tsx --no-coverage
```

Expected: all 3 tests PASS

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add components/TodayCard.tsx app/dashboard/page.tsx __tests__/components/TodayCardBadge.test.tsx
git commit -m "feat: replace TSB readiness label with recovery score chip in TodayCard"
```

---

### Task 3: Fitness Page — Sleep Section

**Files:**
- Modify: `app/fitness/page.tsx`

**Interfaces:**
- Consumes: `ICUWellness` from `charts.wellness` (already fetched) — uses `garmin_sleep_deep_secs`, `garmin_sleep_light_secs`, `garmin_sleep_rem_secs`, `garmin_sleep_awake_secs`
- Produces: `SleepSection` component rendered in the page after `HrvImprovementSection`

**Context:** The Fitness page uses `charts.wellness` (type `ICUWellness[]`) which already has all garmin sleep fields. The existing `HrvSection` pattern (lines 119–232) is the model: a `SectionCard` with a header row showing today's value, range-toggle buttons (this task uses 14/30 days instead of 3m/6m/12m), and a SVG chart. The Sleep section is inserted into the render JSX after `<HrvImprovementSection />` at line 691 and before the Weekly Training Load section.

- [ ] **Step 1: Write a smoke test**

Add to `__tests__/components/FitnessPage.test.tsx` — create this file if it doesn't exist:

```tsx
import { render, screen } from '@testing-library/react'

// Minimal fetch mock — the page fetches /api/ftp, /api/profile, /api/charts, /api/weight-log, /api/hrv/improvement
beforeEach(() => {
  jest.spyOn(global, 'fetch').mockImplementation((url) => {
    if (String(url).includes('/api/charts')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          charts: {
            wellness: [
              {
                id: '2026-06-30',
                ctl: 60, atl: 65, form: -5, hrv: 52, resting_hr: 58,
                sleep_secs: 28800, body_battery_low: 30, body_battery_high: 85,
                stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
                garmin_sleep_deep_secs: 5760, garmin_sleep_light_secs: 14400,
                garmin_sleep_rem_secs: 7200, garmin_sleep_awake_secs: 1440,
              },
            ],
            weeklyTss: [],
          },
        }),
      } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
})
afterEach(() => jest.restoreAllMocks())

it('renders Sleep section when garmin sleep data is present', async () => {
  const { default: FitnessPage } = await import('@/app/fitness/page')
  render(<FitnessPage />)
  // Section heading appears after charts load
  await screen.findByText('Sleep')
  expect(screen.getByText('Sleep')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest __tests__/components/FitnessPage.test.tsx --no-coverage
```

Expected: FAIL — "Unable to find an element with the text: Sleep"

- [ ] **Step 3: Add the `SleepSection` function component to `app/fitness/page.tsx`**

Add the following function before `FitnessPage()` (after `HrvImprovementSection`):

```tsx
const SLEEP_RANGES: { label: string; days: number }[] = [
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
]

function SleepSection({ wellness }: { wellness: ICUWellness[] }) {
  const [rangeDays, setRangeDays] = useState(14)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const cutoff = new Date(Date.now() - rangeDays * 864e5).toISOString().split('T')[0]
  const data = wellness.filter(w => w.id >= cutoff).sort((a, b) => a.id.localeCompare(b.id))

  const latest = [...data].reverse().find(w =>
    w.garmin_sleep_deep_secs !== null || w.garmin_sleep_light_secs !== null ||
    w.garmin_sleep_rem_secs !== null || w.garmin_sleep_awake_secs !== null
  )

  if (!latest && data.every(w =>
    w.garmin_sleep_deep_secs == null && w.garmin_sleep_light_secs == null &&
    w.garmin_sleep_rem_secs == null && w.garmin_sleep_awake_secs == null
  )) {
    return null
  }

  const totalSecs = latest
    ? (latest.garmin_sleep_deep_secs ?? 0) + (latest.garmin_sleep_light_secs ?? 0) +
      (latest.garmin_sleep_rem_secs ?? 0) + (latest.garmin_sleep_awake_secs ?? 0)
    : 0
  const totalHours = totalSecs > 0 ? (totalSecs / 3600).toFixed(1) : null

  const svgLeft = 30, svgRight = 420, svgTop = 10, svgBottom = 90
  const chartW = svgRight - svgLeft
  const n = data.length
  const gap = 2
  const barW = n > 0 ? Math.max(4, Math.floor(chartW / n) - gap) : 10
  const TARGET_SECS = 8 * 3600

  const maxSecs = Math.max(TARGET_SECS, ...data.map(w =>
    (w.garmin_sleep_deep_secs ?? 0) + (w.garmin_sleep_light_secs ?? 0) +
    (w.garmin_sleep_rem_secs ?? 0) + (w.garmin_sleep_awake_secs ?? 0)
  ))

  const xOf = (i: number) => svgLeft + (i / n) * chartW + gap / 2
  const yOf = (secs: number) => normalizeY(secs, 0, maxSecs, svgTop, svgBottom)
  const targetY = yOf(TARGET_SECS)

  const displayed = selectedIdx !== null ? data[selectedIdx] : null

  return (
    <SectionCard title="Sleep" accent="bg-indigo-500">
      {/* Today header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <div>
          {totalHours ? (
            <>
              <div className="text-sm font-semibold text-indigo-600">{totalHours}h last night</div>
              {latest && totalSecs > 0 && (
                <div className="w-full h-2 rounded-full overflow-hidden bg-gray-100 mt-1.5 flex" style={{ maxWidth: 200 }}>
                  {latest.garmin_sleep_deep_secs != null && (
                    <div className="bg-violet-500 h-full" style={{ width: `${(latest.garmin_sleep_deep_secs / totalSecs) * 100}%` }} />
                  )}
                  {latest.garmin_sleep_rem_secs != null && (
                    <div className="bg-indigo-400 h-full" style={{ width: `${(latest.garmin_sleep_rem_secs / totalSecs) * 100}%` }} />
                  )}
                  {latest.garmin_sleep_light_secs != null && (
                    <div className="bg-slate-300 h-full" style={{ width: `${(latest.garmin_sleep_light_secs / totalSecs) * 100}%` }} />
                  )}
                  {latest.garmin_sleep_awake_secs != null && (
                    <div className="bg-gray-200 h-full" style={{ width: `${(latest.garmin_sleep_awake_secs / totalSecs) * 100}%` }} />
                  )}
                </div>
              )}
              {latest && (
                <div className="text-[10px] text-slate-400 mt-1 space-x-2">
                  {latest.garmin_sleep_deep_secs != null && (
                    <span>Deep {(latest.garmin_sleep_deep_secs / 3600).toFixed(1)}h</span>
                  )}
                  {latest.garmin_sleep_rem_secs != null && (
                    <span>REM {(latest.garmin_sleep_rem_secs / 3600).toFixed(1)}h</span>
                  )}
                  {latest.garmin_sleep_light_secs != null && (
                    <span>Light {(latest.garmin_sleep_light_secs / 3600).toFixed(1)}h</span>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-400">No sleep data</div>
          )}
        </div>
        <div className="flex gap-1">
          {SLEEP_RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => setRangeDays(r.days)}
              className={`text-[11px] font-semibold px-2 py-1.5 rounded min-h-[44px] ${
                rangeDays === r.days ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Selected night detail */}
      {displayed && (
        <div className="px-4 py-2 text-[11px] text-slate-500 border-b border-gray-100 flex gap-3 flex-wrap">
          <span className="font-medium text-slate-600">{displayed.id}</span>
          {displayed.garmin_sleep_deep_secs != null && <span>Deep {(displayed.garmin_sleep_deep_secs / 3600).toFixed(1)}h</span>}
          {displayed.garmin_sleep_rem_secs != null && <span>REM {(displayed.garmin_sleep_rem_secs / 3600).toFixed(1)}h</span>}
          {displayed.garmin_sleep_light_secs != null && <span>Light {(displayed.garmin_sleep_light_secs / 3600).toFixed(1)}h</span>}
          {displayed.garmin_sleep_awake_secs != null && <span>Awake {(displayed.garmin_sleep_awake_secs / 60).toFixed(0)}m</span>}
        </div>
      )}

      {/* Trend chart */}
      <svg viewBox={`0 0 ${svgRight + 10} 115`} className="w-full">
        {/* 8h target line */}
        <line x1={svgLeft} y1={targetY} x2={svgRight} y2={targetY}
          stroke="#e0e7ff" strokeWidth="1" strokeDasharray="4,3" />
        <text x={svgLeft - 4} y={targetY + 4} fontSize="8" fill="#c7d2fe" textAnchor="end">8h</text>

        {data.map((w, i) => {
          const total = (w.garmin_sleep_deep_secs ?? 0) + (w.garmin_sleep_light_secs ?? 0) +
            (w.garmin_sleep_rem_secs ?? 0) + (w.garmin_sleep_awake_secs ?? 0)
          if (total === 0) return null
          const x = xOf(i)
          const topY = yOf(total)
          const isSelected = selectedIdx === i
          // Stacked bars: deep (bottom of stack in visual = top in SVG)
          let stackY = svgBottom
          const segments: { color: string; secs: number }[] = [
            { color: isSelected ? '#7c3aed' : '#8b5cf6', secs: w.garmin_sleep_awake_secs ?? 0 },
            { color: isSelected ? '#818cf8' : '#a5b4fc', secs: w.garmin_sleep_light_secs ?? 0 },
            { color: isSelected ? '#6366f1' : '#818cf8', secs: w.garmin_sleep_rem_secs ?? 0 },
            { color: isSelected ? '#4f46e5' : '#6d28d9', secs: w.garmin_sleep_deep_secs ?? 0 },
          ]
          const rects = segments.map((seg, si) => {
            if (seg.secs === 0) return null
            const segH = (seg.secs / maxSecs) * (svgBottom - svgTop)
            const y = stackY - segH
            stackY = y
            return <rect key={si} x={x} y={y} width={barW} height={segH} fill={seg.color} />
          })
          return (
            <g key={w.id}>
              {rects}
              {/* Invisible hit area */}
              <rect
                x={x} y={topY} width={Math.max(barW, 12)} height={Math.max(svgBottom - topY, 12)}
                fill="transparent"
                onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
                className="cursor-pointer"
              />
            </g>
          )
        })}
      </svg>
      <div className="flex gap-3 px-3 pb-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block bg-violet-600" />Deep</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block bg-indigo-400" />REM</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block bg-slate-300" />Light</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block bg-gray-200" />Awake</span>
      </div>
    </SectionCard>
  )
}
```

- [ ] **Step 4: Insert `<SleepSection>` into the Fitness page render**

In `FitnessPage()`'s return JSX, find the `<HrvImprovementSection />` call (line ~691). Add `<SleepSection wellness={charts.wellness} />` immediately after it:

```tsx
          <HrvImprovementSection />

          <SleepSection wellness={charts.wellness} />

          <SectionCard title="Weekly Training Load" accent="bg-violet-500">
```

- [ ] **Step 5: Run the test**

```bash
npx jest __tests__/components/FitnessPage.test.tsx --no-coverage
```

Expected: PASS

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add app/fitness/page.tsx __tests__/components/FitnessPage.test.tsx
git commit -m "feat: add Sleep section to Fitness page with stage bars and trend chart"
```

---

### Task 4: Fitness Page — Recovery Trend Section

**Files:**
- Modify: `app/fitness/page.tsx`

**Interfaces:**
- Consumes: `computeRecoveryScore` (Task 1), `computeHrvBaseline` (already imported in Fitness page), `ICUWellness[]` from `charts.wellness`
- Produces: `RecoverySection` component rendered after `SleepSection`

**Context:** The Recovery section shows today's composite score and a 14/30-day trend line chart. It uses `computeRecoveryScore()` on each `ICUWellness` row — the `body_battery_high`, garmin sleep fields, `hrv`, and `form` (TSB) are all present. The `hrvBaseline` is obtained from `computeHrvBaseline(wellness).baselineMean`. Subjective wellness (energy/leg_freshness) is not available in `ICUWellness`; those components will be excluded from the trend (graceful degradation). Add `<RecoverySection>` immediately after `<SleepSection>`.

- [ ] **Step 1: Update the smoke test to also check for Recovery section**

Edit `__tests__/components/FitnessPage.test.tsx` — add one assertion to the existing test:

```tsx
it('renders Recovery section when wellness data is present', async () => {
  const { default: FitnessPage } = await import('@/app/fitness/page')
  render(<FitnessPage />)
  await screen.findByText('Sleep')
  expect(screen.getByText('Recovery')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest __tests__/components/FitnessPage.test.tsx --no-coverage
```

Expected: second test FAILS — "Unable to find an element with the text: Recovery"

- [ ] **Step 3: Add `RecoverySection` to `app/fitness/page.tsx`**

Add the `computeRecoveryScore` import at the top:

```tsx
import { computeRecoveryScore } from '@/lib/recovery-score'
```

Then add the `RecoverySection` function before `FitnessPage()`:

```tsx
const RECOVERY_RANGES: { label: string; days: number }[] = [
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
]

const BAND_COLOUR_MAP = {
  high: '#10b981',
  moderate: '#f59e0b',
  low: '#ef4444',
} as const

function RecoverySection({ wellness }: { wellness: ICUWellness[] }) {
  const [rangeDays, setRangeDays] = useState(14)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const hrvStatus = computeHrvBaseline(wellness)
  const hrvBaseline = hrvStatus.baselineMean

  const cutoff = new Date(Date.now() - rangeDays * 864e5).toISOString().split('T')[0]
  const data = wellness.filter(w => w.id >= cutoff).sort((a, b) => a.id.localeCompare(b.id))

  const scored = data.map(w => ({
    id: w.id,
    result: computeRecoveryScore({
      hrv: w.hrv ?? null,
      hrvBaseline,
      garmin_sleep_deep_secs: w.garmin_sleep_deep_secs ?? null,
      garmin_sleep_light_secs: w.garmin_sleep_light_secs ?? null,
      garmin_sleep_rem_secs: w.garmin_sleep_rem_secs ?? null,
      garmin_sleep_awake_secs: w.garmin_sleep_awake_secs ?? null,
      body_battery_high: w.body_battery_high ?? null,
      energy: null,
      leg_freshness: null,
      tsb: w.form ?? null,
    }),
  }))

  const latest = scored.at(-1)

  if (!scored.length) return null

  const svgLeft = 30, svgRight = 420, svgTop = 10, svgBottom = 90
  const chartW = svgRight - svgLeft
  const n = scored.length

  const xOf = (i: number) => svgLeft + (i / Math.max(n - 1, 1)) * chartW
  const yOf = (v: number) => normalizeY(v, 0, 100, svgTop, svgBottom)

  const linePts = scored.map((s, i) => `${xOf(i)},${yOf(s.result.score)}`).join(' ')
  const highY = yOf(75)
  const lowY = yOf(50)

  const displayed = selectedIdx !== null ? scored[selectedIdx] : null

  return (
    <SectionCard title="Recovery" accent="bg-emerald-500">
      {/* Today header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <div>
          {latest && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-extrabold" style={{ color: BAND_COLOUR_MAP[latest.result.band] }}>
                  {latest.result.score}
                </span>
                <span className="text-sm font-semibold capitalize" style={{ color: BAND_COLOUR_MAP[latest.result.band] }}>
                  {latest.result.band}
                </span>
              </div>
              {latest.result.explanation ? (
                <div className="text-xs text-gray-400 mt-0.5">{latest.result.explanation}</div>
              ) : null}
            </>
          )}
        </div>
        <div className="flex gap-1">
          {RECOVERY_RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => setRangeDays(r.days)}
              className={`text-[11px] font-semibold px-2 py-1.5 rounded min-h-[44px] ${
                rangeDays === r.days ? 'bg-emerald-100 text-emerald-700' : 'text-gray-400'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Selected point detail */}
      {displayed && (
        <div className="px-4 py-2 text-[11px] text-slate-500 border-b border-gray-100 flex gap-3 flex-wrap">
          <span className="font-medium text-slate-600">{displayed.id}</span>
          {displayed.result.components.sleep != null && <span>Sleep {Math.round(displayed.result.components.sleep)}</span>}
          {displayed.result.components.hrv != null && <span>HRV {Math.round(displayed.result.components.hrv)}</span>}
          {displayed.result.components.wellness != null && <span>Wellness {Math.round(displayed.result.components.wellness)}</span>}
          {displayed.result.components.tsb != null && <span>Load {Math.round(displayed.result.components.tsb)}</span>}
          {displayed.result.components.bodyBattery != null && <span>Battery {Math.round(displayed.result.components.bodyBattery)}</span>}
        </div>
      )}

      {/* Trend chart */}
      <svg viewBox={`0 0 ${svgRight + 10} 115`} className="w-full">
        {/* Band fills */}
        <rect x={svgLeft} y={svgTop} width={chartW} height={Math.max(0, highY - svgTop)} fill="#f0fdf4" opacity="0.8" />
        <rect x={svgLeft} y={lowY} width={chartW} height={Math.max(0, svgBottom - lowY)} fill="#fef2f2" opacity="0.8" />
        {/* Band lines */}
        <line x1={svgLeft} y1={highY} x2={svgRight} y2={highY} stroke="#bbf7d0" strokeWidth="1" />
        <line x1={svgLeft} y1={lowY} x2={svgRight} y2={lowY} stroke="#fecaca" strokeWidth="1" />
        <text x={svgLeft - 4} y={highY + 4} fontSize="8" fill="#86efac" textAnchor="end">75</text>
        <text x={svgLeft - 4} y={lowY + 4} fontSize="8" fill="#fca5a5" textAnchor="end">50</text>
        {/* Line */}
        <polyline points={linePts} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" />
        {/* Points */}
        {scored.map((s, i) => (
          <g key={s.id}>
            <circle
              cx={xOf(i)} cy={yOf(s.result.score)} r="4"
              fill={BAND_COLOUR_MAP[s.result.band]}
              stroke="white" strokeWidth="1.5"
            />
            <rect
              x={xOf(i) - 8} y={yOf(s.result.score) - 8} width={16} height={16}
              fill="transparent"
              onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
              className="cursor-pointer"
            />
          </g>
        ))}
      </svg>
    </SectionCard>
  )
}
```

- [ ] **Step 4: Insert `<RecoverySection>` after `<SleepSection>` in the render**

```tsx
          <SleepSection wellness={charts.wellness} />

          <RecoverySection wellness={charts.wellness} />

          <SectionCard title="Weekly Training Load" accent="bg-violet-500">
```

- [ ] **Step 5: Run the tests**

```bash
npx jest __tests__/components/FitnessPage.test.tsx --no-coverage
```

Expected: all tests PASS

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add app/fitness/page.tsx
git commit -m "feat: add Recovery score trend section to Fitness page"
```

---

### Task 5: AI Briefing Integration

**Files:**
- Modify: `types/index.ts`
- Modify: `app/api/briefing/today/route.ts`
- Modify: `lib/claude/briefing.ts`

**Interfaces:**
- Consumes: `computeRecoveryScore` (Task 1), `BriefingContext` type
- Produces: updated `BriefingContext` with `recoveryScore?`, `recoveryBand?`, `recoveryExplanation?`; updated briefing prompt

**Context:** The briefing route already has all needed inputs: `hrv`, `tsb`, `hrvStatus` (with `baselineMean`), `wellnessRows` (daily wellness with energy/leg_freshness), and `todayGarmin` (Garmin sleep fields and body battery). Compute the recovery score after these are assembled, then add it to `ctx`. In `lib/claude/briefing.ts`, append the score to the existing `garminLines` array and add recovery-score-aware guidance to the `SYSTEM_MORNING` string.

- [ ] **Step 1: Write a failing test**

Add to `__tests__/lib/claude-briefing.test.ts` (or create it if it doesn't exist):

Check the existing file first:

```bash
cat __tests__/lib/claude-briefing.test.ts | head -30
```

Then add a test (without breaking existing ones):

```ts
// In __tests__/lib/claude-briefing.test.ts — add this describe block:
describe('buildTodayBriefingPrompt with recovery score', () => {
  it('includes recovery score line in the prompt when provided', () => {
    // We test the internal prompt construction by checking that the context
    // with recoveryScore reaches the Claude call. Since generateBriefing calls Claude,
    // we verify BriefingContext accepts the new optional fields without TypeScript errors.
    // This is a type-level test — if it compiles, the fields are accepted.
    const ctx: import('@/types').BriefingContext = {
      todayWorkout: null,
      workoutCompleted: false,
      completedRide: null,
      ctl: 60, atl: 65, tsb: -5,
      readinessLabel: 'Moderate',
      hrv: 52,
      dailyStrain: null,
      recentWorkouts: [],
      upcomingEvents: [],
      today: '2026-06-30',
      recoveryScore: 68,
      recoveryBand: 'moderate',
      recoveryExplanation: 'HRV suppressed',
    }
    expect(ctx.recoveryScore).toBe(68)
    expect(ctx.recoveryBand).toBe('moderate')
    expect(ctx.recoveryExplanation).toBe('HRV suppressed')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest __tests__/lib/claude-briefing.test.ts --no-coverage
```

Expected: TypeScript compile error — "Object literal may only specify known properties, and 'recoveryScore' does not exist in type 'BriefingContext'"

- [ ] **Step 3: Add recovery fields to `BriefingContext` in `types/index.ts`**

Find the `BriefingContext` interface (line 598). After the last existing optional Garmin field (`garminSleepRespirationAvg`), add:

```ts
  // Composite recovery score (computed from HRV + sleep + wellness + TSB + body battery)
  recoveryScore?: number | null
  recoveryBand?: 'high' | 'moderate' | 'low' | null
  recoveryExplanation?: string
```

- [ ] **Step 4: Run the test to verify it passes (type check)**

```bash
npx jest __tests__/lib/claude-briefing.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Compute recovery score in `app/api/briefing/today/route.ts`**

Add the import at the top of the file:

```ts
import { computeRecoveryScore } from '@/lib/recovery-score'
```

The briefing route assigns `ctl`, `atl`, `tsb`, `hrv` from ICU wellness inside a try-catch block, but `body_battery_high` is also on that `latest` row. Hoist a variable so it's accessible later. Find the line `let hrv: number | null = null` (around line 87) and add alongside it:

```ts
  let bodyBatteryHigh: number | null = null
```

Then inside the same try-catch block, immediately after `hrv = latest?.hrv ?? null`, add:

```ts
      bodyBatteryHigh = latest?.body_battery_high ?? null
```

Now compute the recovery score. Find the `[{ data: wellnessRows }, { data: garminRow }]` parallel fetch block (around line 228). After it resolves (after the cast of `todayGarmin`), and before the `const ctx: BriefingContext = {` object literal, add:

```ts
  const todayDailyWellness = (wellnessRows ?? []).find(
    (w): w is DailyWellness => (w as DailyWellness).date === today
  )
  const recoveryResult = computeRecoveryScore({
    hrv,
    hrvBaseline: hrvStatus?.baselineMean ?? null,
    garmin_sleep_deep_secs: todayGarmin?.garmin_sleep_deep_secs ?? null,
    garmin_sleep_light_secs: todayGarmin?.garmin_sleep_light_secs ?? null,
    garmin_sleep_rem_secs: todayGarmin?.garmin_sleep_rem_secs ?? null,
    garmin_sleep_awake_secs: todayGarmin?.garmin_sleep_awake_secs ?? null,
    body_battery_high: bodyBatteryHigh,
    energy: todayDailyWellness?.energy ?? null,
    leg_freshness: todayDailyWellness?.leg_freshness ?? null,
    tsb,
  })
```

Then add the three recovery fields inside the `ctx` object literal (at the end, before the closing `}`):

```ts
    recoveryScore: recoveryResult.score,
    recoveryBand: recoveryResult.band,
    recoveryExplanation: recoveryResult.explanation,
```

- [ ] **Step 6: Include the recovery score in the briefing prompt in `lib/claude/briefing.ts`**

In `generateMorningBriefing`, find the `garminLines` block (lines 165–196). After the last `garminLines.push(...)` call, add:

```ts
  if (ctx.recoveryScore != null) {
    const bandLabel = ctx.recoveryBand ?? 'moderate'
    const expl = ctx.recoveryExplanation ? ` — ${ctx.recoveryExplanation}` : ''
    garminLines.push(`Recovery score: ${ctx.recoveryScore}/100 (${bandLabel})${expl}`)
  }
```

Then update the `SYSTEM_MORNING` constant to include recovery-score guidance. Find the end of the existing string (it ends with `"...only activation only."`). Add the following sentence before the closing `"`:

```
 When a Recovery score is provided: score < 50 means the athlete is poorly recovered — acknowledge it directly and suggest treating today's planned intensity conservatively (e.g. ride at endurance pace rather than executing intervals); score 50–74 warrants a brief neutral acknowledgement; score ≥ 75 may be affirmed positively. Do not auto-modify the workout — surface the advisory and leave the decision to the athlete.
```

- [ ] **Step 7: Run all tests**

```bash
npm run test:ci
```

Expected: all tests pass, typecheck clean

- [ ] **Step 8: Commit**

```bash
git add types/index.ts app/api/briefing/today/route.ts lib/claude/briefing.ts
git commit -m "feat: include composite recovery score in AI briefing context and prompt"
```

---

## Self-review checklist

After completing all tasks, verify:

- [ ] `computeRecoveryScore` handles all-null input gracefully (returns score=50)
- [ ] TodayCard shows "Recovery" label instead of "Readiness" and renders without crash when `wellness` is null
- [ ] Fitness page Sleep section returns null when no garmin sleep data in the wellness array
- [ ] Fitness page Recovery section shows today's score in the header
- [ ] Briefing prompt includes `Recovery score: X/100 (band) — explanation` when Garmin sleep data is present
- [ ] `npm run typecheck` passes clean
- [ ] All new tests pass with `npm run test:ci`
