# Whoop-Style Ring Strip Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Whoop-style Recovery/Strain/Sleep ring-strip card to the dashboard, and remove the now-redundant Strain band (`MetricsBar`) and Recovery dot (`TodayCard`) indicators it replaces.

**Architecture:** Three new presentational components — a generic `MetricRing`, a `SleepBreakdownModal` (new, following the existing `RecoveryBreakdownModal` pattern), and a `StrainRingStrip` that composes three rings and owns which breakdown modal is open. `StrainRingStrip` is inserted in `app/dashboard/page.tsx` where the "Fitness stats" card currently begins; `MetricsBar` and `TodayCard` lose the indicators the ring strip now owns.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Jest + Testing Library.

**Prerequisite:** This plan depends on `docs/superpowers/plans/2026-07-18-whoop-aligned-strain-formula.md` being fully implemented and merged first — it consumes `DailyStrainPoint.workoutStrain`, `strainLabel`'s 4-band output, and `StrainBreakdownSheet`'s new `{ strainToday, activities, maxHr, restingHr, onClose }` prop shape, all of which that plan introduces.

## Global Constraints

- Run `npm run typecheck` before every commit.
- Mobile-first PWA: every new component must work at ≥320px width; touch targets ≥44px tall (`min-h-[44px]` on tappable rings/buttons); modals use `items-end sm:items-center` … actually this app's existing modals (`RecoveryBreakdownModal`, `StrainBreakdownSheet`) use `flex items-center justify-center` without the bottom-sheet-on-mobile variant — match that existing pattern exactly for `SleepBreakdownModal`, don't introduce a new modal chrome style.
- Never use `git commit --amend`; always create new commits.

---

## File Structure

| File | Responsibility |
|---|---|
| `components/MetricRing.tsx` | New — generic single-value conic-gradient ring, reused 3× |
| `components/SleepBreakdownModal.tsx` | New — sleep duration/stage breakdown, modeled on `RecoveryBreakdownModal` |
| `components/StrainRingStrip.tsx` | New — composes the 3 rings, owns modal-open state |
| `app/dashboard/page.tsx` | Inserts `StrainRingStrip`, computes `recovery` at page level, removes the old standalone `StrainBreakdownSheet` wiring (now owned by `StrainRingStrip`) |
| `components/TodayCard.tsx` | Removes the Recovery dot header button and its `computeRecoveryScore` call |
| `components/MetricsBar.tsx` | Removes the colored Strain band + progress bar + `onStrainTap`/`strainToday` props |

---

### Task 1: `components/MetricRing.tsx` — shared ring component

**Files:**
- Create: `components/MetricRing.tsx`
- Test: `__tests__/components/MetricRing.test.tsx`

**Interfaces:**
- Produces: `MetricRing({ displayValue, pct, label, bandLabel, color, onTap? })` — consumed by Task 4 (`StrainRingStrip`).

- [ ] **Step 1: Write the failing test**

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import MetricRing from '@/components/MetricRing'

test('renders the display value, label, and band label', () => {
  render(<MetricRing displayValue="78" pct={78} label="Recovery" bandLabel="High" color="#059669" />)
  expect(screen.getByText('78')).toBeInTheDocument()
  expect(screen.getByText('Recovery')).toBeInTheDocument()
  expect(screen.getByText('High')).toBeInTheDocument()
})

test('calls onTap when clicked, and renders as a button', () => {
  const onTap = jest.fn()
  render(<MetricRing displayValue="13" pct={62} label="Strain" bandLabel="Moderate" color="#d97706" onTap={onTap} />)
  fireEvent.click(screen.getByRole('button'))
  expect(onTap).toHaveBeenCalledTimes(1)
})

test('renders without a button role when onTap is not provided', () => {
  render(<MetricRing displayValue="85" pct={85} label="Sleep" bandLabel="Good" color="#059669" />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- __tests__/components/MetricRing.test.tsx`
Expected: FAIL — `components/MetricRing.tsx` doesn't exist.

- [ ] **Step 3: Implement the component**

```typescript
'use client'

interface MetricRingProps {
  displayValue: string
  pct: number       // 0-100, portion of the ring to fill
  label: string
  bandLabel: string
  color: string      // hex color for the filled arc and band label text
  onTap?: () => void
}

export default function MetricRing({ displayValue, pct, label, bandLabel, color, onTap }: MetricRingProps) {
  const clamped = Math.max(0, Math.min(100, pct))
  const ring = (
    <>
      <div
        className="rounded-full flex items-center justify-center"
        style={{ width: 72, height: 72, background: `conic-gradient(${color} 0% ${clamped}%, #e5e7eb ${clamped}% 100%)` }}
      >
        <div className="rounded-full bg-white flex items-center justify-center" style={{ width: 56, height: 56 }}>
          <span className="text-[19px] font-black text-gray-900">{displayValue}</span>
        </div>
      </div>
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1.5">{label}</span>
      <span className="text-[10px] font-bold" style={{ color }}>{bandLabel}</span>
    </>
  )

  if (onTap) {
    return (
      <button
        type="button"
        onClick={onTap}
        className="flex flex-col items-center flex-1 min-h-[44px]"
        aria-label={`${label} breakdown`}
      >
        {ring}
      </button>
    )
  }
  return <div className="flex flex-col items-center flex-1">{ring}</div>
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- __tests__/components/MetricRing.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/MetricRing.tsx __tests__/components/MetricRing.test.tsx
git commit -m "feat: add shared MetricRing component for the Whoop-style dashboard rings"
```

---

### Task 2: `components/SleepBreakdownModal.tsx`

**Files:**
- Create: `components/SleepBreakdownModal.tsx`
- Test: `__tests__/components/SleepBreakdownModal.test.tsx`

**Interfaces:**
- Consumes: `ICUWellness` from `@/types` (existing).
- Produces: `SleepBreakdownModal({ wellness, onClose })` — consumed by Task 4 (`StrainRingStrip`).

- [ ] **Step 1: Write the failing test**

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import SleepBreakdownModal from '@/components/SleepBreakdownModal'
import type { ICUWellness } from '@/types'

const baseWellness = {
  id: '2026-07-18', ctl: null, atl: null, form: null, hrv: null, resting_hr: null, sleep_secs: null,
  body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null,
  garmin_training_load: null, sleep_score: null,
} as ICUWellness

test('shows the sleep score and band when present', () => {
  render(<SleepBreakdownModal wellness={{ ...baseWellness, sleep_score: 85 }} onClose={jest.fn()} />)
  expect(screen.getByText('85')).toBeInTheDocument()
  expect(screen.getByText('high')).toBeInTheDocument()
})

test('shows sleep stages when present', () => {
  render(<SleepBreakdownModal
    wellness={{ ...baseWellness, sleep_score: 70, garmin_sleep_deep_secs: 5400, garmin_sleep_rem_secs: 3600 }}
    onClose={jest.fn()}
  />)
  expect(screen.getByText(/Deep/)).toBeInTheDocument()
  expect(screen.getByText(/90m/)).toBeInTheDocument()
  expect(screen.getByText(/REM/)).toBeInTheDocument()
})

test('shows "Not synced" when no sleep score is available', () => {
  render(<SleepBreakdownModal wellness={baseWellness} onClose={jest.fn()} />)
  expect(screen.getByText('Not synced')).toBeInTheDocument()
})

test('close button calls onClose', () => {
  const onClose = jest.fn()
  render(<SleepBreakdownModal wellness={baseWellness} onClose={onClose} />)
  fireEvent.click(screen.getByText('Close'))
  expect(onClose).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- __tests__/components/SleepBreakdownModal.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```typescript
'use client'
import type { ICUWellness } from '@/types'

interface Props {
  wellness: ICUWellness
  onClose: () => void
}

type Band = 'high' | 'moderate' | 'low'

function bandFor(score: number): Band {
  if (score >= 75) return 'high'
  if (score >= 50) return 'moderate'
  return 'low'
}

const BAND_BG: Record<Band, string> = {
  high: 'bg-emerald-500', moderate: 'bg-amber-500', low: 'bg-red-500',
}

export default function SleepBreakdownModal({ wellness, onClose }: Props) {
  const score = wellness.sleep_score
  const band = score != null ? bandFor(score) : null
  const deepSecs = wellness.garmin_sleep_deep_secs ?? null
  const lightSecs = wellness.garmin_sleep_light_secs ?? null
  const remSecs = wellness.garmin_sleep_rem_secs ?? null
  const awakeSecs = wellness.garmin_sleep_awake_secs ?? null
  const hasStages = deepSecs != null || lightSecs != null || remSecs != null || awakeSecs != null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white w-full max-w-sm rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 pb-5 pt-5">
          <div className="mb-4">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-1">
              Sleep Breakdown
            </p>
            {score != null ? (
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-gray-900">{score}</span>
                <span className="text-sm text-gray-400">/ 100</span>
                {band && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white capitalize ${BAND_BG[band]}`}>
                    {band}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-300">Not synced</p>
            )}
          </div>

          {wellness.sleep_secs != null && (
            <p className="text-sm text-gray-700 mb-3">
              Duration <span className="text-gray-400">{(wellness.sleep_secs / 3600).toFixed(1)}h</span>
            </p>
          )}

          {hasStages && (
            <div className="space-y-2 pl-1">
              {deepSecs != null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-violet-400" />
                  <span className="text-xs text-gray-700">Deep <span className="text-gray-400">{Math.round(deepSecs / 60)}m</span></span>
                </div>
              )}
              {remSecs != null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-indigo-400" />
                  <span className="text-xs text-gray-700">REM <span className="text-gray-400">{Math.round(remSecs / 60)}m</span></span>
                </div>
              )}
              {lightSecs != null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-violet-200" />
                  <span className="text-xs text-gray-700">Light <span className="text-gray-400">{Math.round(lightSecs / 60)}m</span></span>
                </div>
              )}
              {awakeSecs != null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-gray-300" />
                  <span className="text-xs text-gray-700">Awake <span className="text-gray-400">{Math.round(awakeSecs / 60)}m</span></span>
                </div>
              )}
            </div>
          )}

          {score == null && wellness.sleep_secs == null && !hasStages && (
            <p className="text-xs text-gray-300">No sleep data synced for today</p>
          )}

          <div className="flex justify-end mt-5">
            <button
              onClick={onClose}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors min-h-[44px] px-2"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- __tests__/components/SleepBreakdownModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/SleepBreakdownModal.tsx __tests__/components/SleepBreakdownModal.test.tsx
git commit -m "feat: add SleepBreakdownModal, opened by the new Sleep ring"
```

---

### Task 3: Remove the Recovery dot from `TodayCard.tsx`

**Files:**
- Modify: `components/TodayCard.tsx`
- Modify: `app/dashboard/page.tsx` (drop the now-unused `hrvBaseline` prop passed to `TodayCard`, only if Step 3 below confirms it's dead)
- Test: `__tests__/components/TodayCard.test.tsx` — remove/replace any assertions on the recovery dot (`data-testid="recovery-score"`), `Recovery` text, or `RecoveryBreakdownModal` rendering from within `TodayCard`

**Interfaces:**
- None produced — this is a pure removal. `RecoveryScore`/`computeRecoveryScore` usage moves to Task 5 (`app/dashboard/page.tsx`), which will compute it once and pass to `StrainRingStrip` (Task 4).

- [ ] **Step 1: Remove the recovery computation and header button**

In `components/TodayCard.tsx`:
- Delete the import `import RecoveryBreakdownModal from '@/components/RecoveryBreakdownModal'` and `import { computeRecoveryScore } from '@/lib/recovery-score'`.
- Delete the `BAND_COLOUR` and `BAND_DOT` constants (lines 23–33).
- Delete the `showRecoveryBreakdown` state (`const [showRecoveryBreakdown, setShowRecoveryBreakdown] = useState(false)`).
- Delete the `recovery` computation block (was lines 127–138, the `computeRecoveryScore({...})` call and its `tsb` dependency — check first whether `tsb` is used anywhere else in the file via `Grep -n "\btsb\b" components/TodayCard.tsx`; if `tsb` has no other use, delete its declaration too).
- Replace the header block (was lines 152–174):

```jsx
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Today</p>
        <p className="text-sm font-medium text-slate-700 mt-0.5">{dateLabel} · {dayType}</p>
      </div>
```

(drops the wrapping `flex items-start justify-between` — verify whether anything else in that row needs the flex layout; if the header no longer needs a right-hand column at all, this can be a plain block instead of a flex row. Keep it simple: just the two `<p>` tags, no wrapping flex div needed since there's nothing to justify-between anymore.)

- Delete the `RecoveryBreakdownModal` conditional render near the end of the file (`{showRecoveryBreakdown && (...)}`).

- [ ] **Step 2: Check whether `hrvBaseline` is now dead**

Run: `Grep -n "hrvBaseline" components/TodayCard.tsx`
If the only remaining match is the prop declaration in the `Props` interface and destructuring (no usage in the component body), remove `hrvBaseline?: number | null` from the `Props` interface and from the destructured function parameters. Then run `Grep -n "hrvBaseline" app/dashboard/page.tsx` and remove the `hrvBaseline={hrvStatus.baselineMean}` prop from the `<TodayCard .../>` call site (this will be touched again in Task 5, so it's fine to do it here or there — do it here to keep `TodayCard`'s cleanup self-contained).

- [ ] **Step 3: Update `__tests__/components/TodayCard.test.tsx`**

Run `Grep -n "recovery-score\|Recovery\|RecoveryBreakdownModal\|hrvBaseline" __tests__/components/TodayCard.test.tsx` and remove or update every matched test/assertion — recovery display is no longer TodayCard's responsibility.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- __tests__/components/TodayCard.test.tsx && npm run typecheck`
Expected: Tests pass. Typecheck may show an error in `app/dashboard/page.tsx` if Step 2's prop removal wasn't mirrored there yet — that's fixed in Task 5; if you removed it here, this should be clean already.

- [ ] **Step 5: Commit**

```bash
git add components/TodayCard.tsx app/dashboard/page.tsx __tests__/components/TodayCard.test.tsx
git commit -m "feat: remove TodayCard's Recovery dot — superseded by the dashboard ring strip"
```

---

### Task 4: `components/StrainRingStrip.tsx`

**Files:**
- Create: `components/StrainRingStrip.tsx`
- Test: `__tests__/components/StrainRingStrip.test.tsx`

**Interfaces:**
- Consumes: `MetricRing` (Task 1), `SleepBreakdownModal` (Task 2), `StrainBreakdownSheet` and `RecoveryBreakdownModal` (existing, `StrainBreakdownSheet`'s shape from the prerequisite plan), `strainLabel` from `@/lib/strain`, `RecoveryScore` from `@/lib/recovery-score`, `ICUWellness`/`DailyStrainPoint` from `@/types`.
- Produces: `StrainRingStrip({ recovery, strainToday, wellness, activities, maxHr, restingHr })` — consumed by Task 5 (`app/dashboard/page.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import StrainRingStrip from '@/components/StrainRingStrip'
import type { ICUWellness } from '@/types'

const wellness = {
  id: '2026-07-18', ctl: null, atl: null, form: null, hrv: null, resting_hr: null, sleep_secs: null,
  body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null,
  garmin_training_load: null, sleep_score: 85,
} as ICUWellness

const recovery = { score: 78, band: 'high' as const, explanation: '', components: { sleep: 80, hrv: 75, wellness: null, tsb: null, bodyBattery: null } }
const strainToday = { date: '2026-07-18', dailyTrimp: 108, trimpRef: 150, workoutStrain: 13 }

test('renders all three rings with their values', () => {
  render(
    <StrainRingStrip recovery={recovery} strainToday={strainToday} wellness={wellness} activities={[]} maxHr={190} restingHr={50} />
  )
  expect(screen.getByText('78')).toBeInTheDocument()
  expect(screen.getByText('13')).toBeInTheDocument()
  expect(screen.getByText('85')).toBeInTheDocument()
})

test('tapping the Strain ring opens the strain breakdown sheet', () => {
  render(
    <StrainRingStrip recovery={recovery} strainToday={strainToday} wellness={wellness} activities={[]} maxHr={190} restingHr={50} />
  )
  fireEvent.click(screen.getByRole('button', { name: /Strain breakdown/i }))
  expect(screen.getByText('Strain Breakdown')).toBeInTheDocument()
})

test('tapping the Recovery ring opens the recovery breakdown modal', () => {
  render(
    <StrainRingStrip recovery={recovery} strainToday={strainToday} wellness={wellness} activities={[]} maxHr={190} restingHr={50} />
  )
  fireEvent.click(screen.getByRole('button', { name: /Recovery breakdown/i }))
  expect(screen.getByText('Recovery Breakdown')).toBeInTheDocument()
})

test('tapping the Sleep ring opens the sleep breakdown modal', () => {
  render(
    <StrainRingStrip recovery={recovery} strainToday={strainToday} wellness={wellness} activities={[]} maxHr={190} restingHr={50} />
  )
  fireEvent.click(screen.getByRole('button', { name: /Sleep breakdown/i }))
  expect(screen.getByText('Sleep Breakdown')).toBeInTheDocument()
})

test('renders placeholder dashes when strainToday is null', () => {
  render(
    <StrainRingStrip recovery={recovery} strainToday={null} wellness={wellness} activities={[]} maxHr={190} restingHr={50} />
  )
  expect(screen.getAllByText('—').length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- __tests__/components/StrainRingStrip.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```typescript
'use client'
import { useState } from 'react'
import MetricRing from '@/components/MetricRing'
import StrainBreakdownSheet from '@/components/StrainBreakdownSheet'
import RecoveryBreakdownModal from '@/components/RecoveryBreakdownModal'
import SleepBreakdownModal from '@/components/SleepBreakdownModal'
import { strainLabel } from '@/lib/strain'
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- __tests__/components/StrainRingStrip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/StrainRingStrip.tsx __tests__/components/StrainRingStrip.test.tsx
git commit -m "feat: add StrainRingStrip composing the Recovery/Strain/Sleep rings"
```

---

### Task 5: Wire `StrainRingStrip` into `app/dashboard/page.tsx`; remove the old standalone strain sheet wiring

**Files:**
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `StrainRingStrip` (Task 4), `computeRecoveryScore` from `@/lib/recovery-score` (existing — moves here from `TodayCard.tsx`).

- [ ] **Step 1: Add the import and compute `recovery` at page level**

Add near the other `lib/` imports:

```typescript
import { computeRecoveryScore } from '@/lib/recovery-score'
import StrainRingStrip from '@/components/StrainRingStrip'
```

Immediately after the `strainToday` derivation added in the prerequisite plan's Task 4 (`const strainToday = chartsData?.dailyStrain.find(...) ?? null`), add:

```typescript
  const tsbForRecovery = latestWellnessWithLoad?.form ?? (
    latestWellnessWithLoad?.ctl != null && latestWellnessWithLoad?.atl != null
      ? latestWellnessWithLoad.ctl - latestWellnessWithLoad.atl
      : null
  )
  const recovery = computeRecoveryScore({
    hrv: latestWellnessWithLoad?.hrv ?? null,
    hrvBaseline: hrvStatus.baselineMean,
    garmin_sleep_deep_secs: latestWellnessWithLoad?.garmin_sleep_deep_secs ?? null,
    garmin_sleep_light_secs: latestWellnessWithLoad?.garmin_sleep_light_secs ?? null,
    garmin_sleep_rem_secs: latestWellnessWithLoad?.garmin_sleep_rem_secs ?? null,
    garmin_sleep_awake_secs: latestWellnessWithLoad?.garmin_sleep_awake_secs ?? null,
    body_battery_high: latestWellnessWithLoad?.body_battery_high ?? null,
    energy: todayDailyWellnessForCard?.energy ?? null,
    leg_freshness: todayDailyWellnessForCard?.leg_freshness ?? null,
    tsb: tsbForRecovery,
  })
```

This replicates exactly what `TodayCard.tsx` used to compute internally (Task 3 removed it from there), sourced from variables already in scope on this page (`latestWellnessWithLoad`, `hrvStatus`, `todayDailyWellnessForCard` — confirm these exact names still exist after the prerequisite plan's edits via `Grep -n "todayDailyWellnessForCard\|latestWellnessWithLoad" app/dashboard/page.tsx` before wiring this in).

- [ ] **Step 2: Insert the ring strip above the Fitness stats card**

Immediately before the `{latestWellnessWithLoad && (` block that renders the `bg-white rounded-xl ... divide-y` Fitness stats card (containing `MetricsBar`), insert:

```jsx
      {latestWellnessWithLoad && (
        <StrainRingStrip
          recovery={recovery}
          strainToday={strainToday}
          wellness={latestWellnessWithLoad}
          activities={todayActivities.map(a => ({
            name: a.name,
            durationMin: a.moving_time / 60,
            avgHr: a.average_heartrate,
            trainingLoad: a.training_load,
          }))}
          maxHr={resolveMaxHrFromProfile({ max_hr_manual: profile?.max_hr_manual, date_of_birth: profile?.date_of_birth, observed_max_hr: profile?.observed_max_hr })?.value ?? null}
          restingHr={latestWellnessWithLoad.garmin_resting_hr ?? latestWellnessWithLoad.resting_hr ?? null}
        />
      )}
```

(`resolveMaxHrFromProfile` should already be imported from the prerequisite plan's Task 5 — verify with `Grep -n "resolveMaxHrFromProfile" app/dashboard/page.tsx`; if not present, add `import { resolveMaxHrFromProfile } from '@/lib/max-hr'`.)

- [ ] **Step 3: Remove the old standalone `StrainBreakdownSheet` rendering and `strainSheetOpen` state**

`StrainRingStrip` now owns opening `StrainBreakdownSheet` internally (Task 4). Remove:
- The `strainSheetOpen` state declaration and its setter (`const [strainSheetOpen, setStrainSheetOpen] = useState(false)` or similar — find with `Grep -n "strainSheetOpen" app/dashboard/page.tsx`).
- The `onStrainTap={() => setStrainSheetOpen(true)}` prop passed to `MetricsBar` (also removed as part of Task 6 below, since `MetricsBar` no longer accepts this prop at all).
- The standalone `{strainSheetOpen && latestWellnessWithLoad && (<StrainBreakdownSheet .../>)}` block at the end of the file (this was wired in the prerequisite plan's Task 5 Step 4 — it's being superseded by `StrainRingStrip`'s internal rendering, not duplicated).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: Errors remain only in `components/MetricsBar.tsx` if Task 6 hasn't run yet (it still declares `onStrainTap`/`strainToday` props that page.tsx no longer passes — that's fine, extra unused optional props don't error; the real remaining errors are inside `MetricsBar.tsx` itself once Task 6 starts removing things). If `app/dashboard/page.tsx` itself has zero errors at this point, proceed.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: insert Whoop-style ring strip above the Fitness stats card"
```

---

### Task 6: Remove the colored Strain band from `MetricsBar.tsx`

**Files:**
- Modify: `components/MetricsBar.tsx`
- Modify: `app/dashboard/page.tsx` (drop `onStrainTap`/`strainToday` props from the `<MetricsBar .../>` call, if not already done in Task 5)
- Test: `__tests__/components/MetricsBar.test.tsx` — remove assertions on the band/progress bar; keep assertions on the metric chip row and trend chart

**Interfaces:**
- None produced — `strainHistory` remains the only strain-related prop (still needed by the trend chart).

- [ ] **Step 1: Remove the band JSX and its state/props**

In `components/MetricsBar.tsx`, replace the `strainCategory`-conditional block (the `{strainCategory ? (<>...<)/> ) : ( /* Fallback gray header */ ... )}` — was originally lines 397–439, now shifted after the prerequisite plan's Task 4 edits) entirely with nothing — the component's returned JSX goes straight from the outer wrapping `<div>` to the metric chips row:

```jsx
    <div className={embedded ? 'overflow-hidden' : 'bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden'}>

      <div className="flex divide-x divide-gray-100">
        <Metric label="CTL" value={wellness.ctl} valueClass="text-blue-600" />
        {/* ...unchanged rest of the metric row and everything below it... */}
```

Remove the now-unused `dailyStrain`, `strainCategory`, `BAND_BG`, `BAND_LABEL`, `onStrainTap`, `strainToday`, and `lastRideLabel` (only used inside the deleted band's right-hand column — confirm with `Grep -n "lastRideLabel" components/MetricsBar.tsx` that it has no other use before deleting; if the dashboard page still wants to show "Last ride" somewhere, that's a product decision outside this plan's scope — for now, delete it along with the band since that's its only current usage) declarations and prop-interface entries.

Final `MetricsBar` prop interface:

```typescript
export default function MetricsBar({
  wellness,
  stale = {},
  embedded = false,
  strainHistory,
  hrvStatus,
}: {
  wellness: ICUWellness | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  strainHistory?: DailyStrainPoint[]
  hrvStatus?: HrvStatus | null
}) {
```

- [ ] **Step 2: Update `app/dashboard/page.tsx`'s `MetricsBar` call**

```jsx
          <MetricsBar
            wellness={latestWellnessWithLoad}
            stale={wellnessStale}
            embedded
            strainHistory={chartsData?.dailyStrain}
            hrvStatus={hrvStatus}
          />
```

(Drops `lastRideLabel`, `onStrainTap`, `strainToday`. If `lastRide`/`formatLastRide()` in `app/dashboard/page.tsx` have no other consumer after this, `Grep -n "lastRide\b" app/dashboard/page.tsx` to check whether to remove them too — leave them if anything else on the page still shows "last ride" information; this plan doesn't require removing them beyond disconnecting them from `MetricsBar`.)

- [ ] **Step 3: Update `__tests__/components/MetricsBar.test.tsx`**

Remove any test asserting on the band text (`'Light'`/`'Moderate'`/`'High'`/`'All Out'` as a colored header), the progress bar, `onStrainTap` click behavior, or the "Fitness Stats" gray fallback header. Keep/adapt tests for the metric chip row (CTL/ATL/Form/HRV/Resting HR), the training-status pill, and the collapsible strain trend chart (still driven by `strainHistory`).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- __tests__/components/MetricsBar.test.tsx && npm run typecheck`
Expected: Tests pass, zero typecheck errors anywhere in the repo.

- [ ] **Step 5: Commit**

```bash
git add components/MetricsBar.tsx app/dashboard/page.tsx __tests__/components/MetricsBar.test.tsx
git commit -m "feat: remove MetricsBar's colored Strain band — superseded by the ring strip"
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full CI check**

Run: `npm run test:ci`
Expected: All tests pass, zero typecheck errors.

- [ ] **Step 2: Grep for leftover references**

Run: `Grep -rn "onStrainTap|BAND_DOT|showRecoveryBreakdown" --glob '*.tsx'`
Expected: No matches (these were all removed in Tasks 3 and 6).

- [ ] **Step 3: Manually verify in the running app**

Start the dev server (`npm run dev`) if not already running, load the dashboard, and confirm: a new card near the top shows three rings (Recovery/Strain/Sleep) with correct numbers and colors; tapping each ring opens its respective modal/sheet and closes on "Close"; `TodayCard`'s header no longer shows a Recovery dot; the Fitness stats card no longer shows a colored Strain band — it starts directly with the CTL/ATL/Form/HRV/Resting HR row; the app is usable end-to-end at a 375px viewport width (mobile-first check per `AGENTS.md`).

- [ ] **Step 4: Report completion to the user**

Summarize what changed and confirm the Whoop-aligned strain spec (both plans) is now fully implemented.

---

## Self-Review Notes

- **Spec coverage:** "Layout" (ring trio, conic-gradient, no new charting lib) → Task 1. "Placement" (replaces MetricsBar's card position) → Task 5. "Removed duplicates" (Recovery dot, Strain band) → Tasks 3, 6. "New shared component" (`MetricRing`) → Task 1. "Tap targets" (Recovery/Strain/Sleep modals) → Tasks 2, 4. "Sleep ring value" (reuse `sleep_score`) → Task 2. "Color mapping" (4-tier Strain, 3-tier Recovery/Sleep) → Task 4.
- **Placeholder scan:** no TBD/TODO markers; every code step is complete, runnable code.
- **Type consistency:** `DailyStrainPoint`, `RecoveryScore`, and the `ActivityInput` shape (`name`/`durationMin`/`avgHr`/`trainingLoad`) match the prerequisite plan's `StrainBreakdownSheet` prop shape exactly across Tasks 4 and 5.
