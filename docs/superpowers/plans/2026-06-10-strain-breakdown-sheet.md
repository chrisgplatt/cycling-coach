# Strain Breakdown Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping the strain band on MetricsBar opens a bottom sheet showing the workout and wellbeing components of the daily strain score, with raw source values (TSS, stress avg/peak, sleep score, body battery).

**Architecture:** Add `computeStrainComponents` to `lib/strain.ts` to expose the sub-scores needed for display. A new `StrainBreakdownSheet` component renders the sheet. MetricsBar gains an optional `onStrainTap` prop. Dashboard wires state and passes the sheet wellness + activity summary.

**Tech Stack:** React, Tailwind CSS, TypeScript. No new dependencies.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `lib/strain.ts` | Modify | Add `StrainComponents` interface + `computeStrainComponents` |
| `__tests__/lib/strain.test.ts` | Modify | Tests for `computeStrainComponents` |
| `components/StrainBreakdownSheet.tsx` | Create | Bottom sheet component |
| `components/MetricsBar.tsx` | Modify | Add `onStrainTap` prop; make band tappable |
| `app/dashboard/page.tsx` | Modify | State, activitySummary, render sheet |

---

## Task 1 — `computeStrainComponents` in `lib/strain.ts`

**Files:**
- Modify: `lib/strain.ts`
- Modify: `__tests__/lib/strain.test.ts`

The sheet needs individual sub-scores for the two bars and three sub-signal rows, plus un-normalised raw pts for the donut ring proportions. One new exported interface and one new exported function.

- [ ] **Step 1: Write the failing tests**

Add this describe block to `__tests__/lib/strain.test.ts` (after the existing `computeDailyLifeLoad` describe block). First add the import:

```typescript
import {
  computeDailyStrain,
  computeDailyLifeLoad,
  computeStrainComponents,
  strainLabel,
  formatStrainForPrompt,
  formatStrainHistoryForPrompt,
} from '@/lib/strain'
```

Then add:

```typescript
describe('computeStrainComponents', () => {
  test('returns null when all inputs null', () => {
    expect(computeStrainComponents(null, null, null, null, null)).toBeNull()
  })

  test('workoutPts = (load / 400) * 14', () => {
    const c = computeStrainComponents(200, null, null, null, null)
    expect(c).not.toBeNull()
    expect(c!.workoutPts).toBeCloseTo(7, 1)   // (200/400)*14 = 7
    expect(c!.workoutLoad).toBe(200)
  })

  test('lifePts matches computeDailyLifeLoad', () => {
    const c = computeStrainComponents(0, 54, null, 85, 75)!
    const expected = computeDailyLifeLoad(54, null, 85, 75)!
    expect(c.lifePts).toBeCloseTo(expected, 4)
  })

  test('raw sub-scores are un-normalised', () => {
    // stress=54 only: raw = (54/100)*3.5 = 1.89; normalised life = 3.78
    // stressRawPts should be 1.89, not 3.78
    const c = computeStrainComponents(0, 54, null, null, null)!
    expect(c.stressRawPts).toBeCloseTo(1.89, 1)
    expect(c.sleepRawPts).toBe(0)
    expect(c.batteryRawPts).toBe(0)
  })

  test('source values pass through unchanged', () => {
    const c = computeStrainComponents(100, 60, 75, 72, 35)!
    expect(c.stressAvg).toBe(60)
    expect(c.stressHigh).toBe(75)
    expect(c.sleepScore).toBe(72)
    expect(c.bodyBatteryLow).toBe(35)
  })

  test('no workout today — workoutPts is 0', () => {
    const c = computeStrainComponents(0, 58, null, null, null)!
    expect(c.workoutPts).toBe(0)
    expect(c.workoutLoad).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest __tests__/lib/strain.test.ts --no-coverage
```

Expected: 6 failures like `TypeError: computeStrainComponents is not a function`

- [ ] **Step 3: Add the interface and function to `lib/strain.ts`**

Add after the `computeDailyLifeLoad` function (before `computeDailyStrain`):

```typescript
export interface StrainComponents {
  workoutPts: number        // 0–14 workout contribution
  workoutLoad: number       // raw activity load (TSS-equivalent)
  lifePts: number           // 0–7 normalised life contribution
  stressRawPts: number      // un-normalised stress pts (for donut)
  sleepRawPts: number       // un-normalised sleep pts (for donut)
  batteryRawPts: number     // un-normalised battery pts (for donut)
  stressAvg: number | null
  stressHigh: number | null
  sleepScore: number | null
  bodyBatteryLow: number | null
}

export function computeStrainComponents(
  activityLoad: number | null,
  stressAvg: number | null,
  stressHigh: number | null,
  sleepScore: number | null,
  bodyBatteryLow: number | null,
): StrainComponents | null {
  if (activityLoad == null && stressAvg == null && sleepScore == null && bodyBatteryLow == null) return null
  const load = activityLoad ?? 0
  const workoutPts = Math.min(STRAIN_WORKOUT_WEIGHT, (load / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT)
  let stressRawPts = 0
  let sleepRawPts = 0
  let batteryRawPts = 0
  let availableWeight = 0
  if (stressAvg != null) {
    const effective = stressHigh != null ? stressAvg * 0.7 + stressHigh * 0.3 : stressAvg
    stressRawPts = (effective / 100) * STRAIN_STRESS_WEIGHT
    availableWeight += STRAIN_STRESS_WEIGHT
  }
  if (sleepScore != null) {
    sleepRawPts = ((100 - sleepScore) / 100) * STRAIN_SLEEP_WEIGHT
    availableWeight += STRAIN_SLEEP_WEIGHT
  }
  if (bodyBatteryLow != null) {
    batteryRawPts = ((100 - bodyBatteryLow) / 100) * STRAIN_BATTERY_WEIGHT
    availableWeight += STRAIN_BATTERY_WEIGHT
  }
  const rawLife = stressRawPts + sleepRawPts + batteryRawPts
  const lifePts = availableWeight > 0 ? (rawLife / availableWeight) * STRAIN_LIFE_WEIGHT : 0
  return { workoutPts, workoutLoad: load, lifePts, stressRawPts, sleepRawPts, batteryRawPts, stressAvg, stressHigh, sleepScore, bodyBatteryLow }
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```
npx jest __tests__/lib/strain.test.ts --no-coverage
```

Expected: all tests pass (35 total)

- [ ] **Step 5: Typecheck**

```
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```
git add lib/strain.ts __tests__/lib/strain.test.ts
git commit -m "feat: add computeStrainComponents for strain breakdown display"
```

---

## Task 2 — `StrainBreakdownSheet` component

**Files:**
- Create: `components/StrainBreakdownSheet.tsx`

The bottom sheet renders two bars (Workout, Wellbeing), a donut ring, and three sub-signal rows under Wellbeing. Follows the same modal shell pattern as `ActivityDetailModal` (fixed inset, scrim, slides from bottom on mobile, centred on sm+).

- [ ] **Step 1: Create `components/StrainBreakdownSheet.tsx`**

```typescript
'use client'
import { computeStrainComponents, strainLabel } from '@/lib/strain'
import type { ICUWellness } from '@/types'

interface Props {
  wellness: ICUWellness
  activitySummary?: string
  onClose: () => void
}

const BAND_BG: Record<string, string> = {
  low: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  high: 'bg-red-500',
}

export default function StrainBreakdownSheet({ wellness, activitySummary, onClose }: Props) {
  const c = computeStrainComponents(
    wellness.garmin_training_load,
    wellness.stress_avg,
    wellness.stress_high,
    wellness.sleep_score,
    wellness.body_battery_low,
  )
  if (!c) return null

  const totalStrain = Math.min(21, Math.round(c.workoutPts + c.lifePts))
  const label = strainLabel(totalStrain)

  // Donut: use raw un-normalised pts as fractions of 21 for proportional arcs
  const d = 21
  const w  = (c.workoutPts  / d) * 100
  const s  = (c.stressRawPts  / d) * 100
  const sl = (c.sleepRawPts   / d) * 100
  const b  = (c.batteryRawPts / d) * 100
  const donut = `conic-gradient(
    #3b82f6 0% ${w}%,
    #f59e0b ${w}% ${w + s}%,
    #8b5cf6 ${w + s}% ${w + s + sl}%,
    #10b981 ${w + s + sl}% ${w + s + sl + b}%,
    #e2e8f0 ${w + s + sl + b}% 100%
  )`

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full rounded-t-2xl sm:rounded-2xl sm:max-w-sm max-h-[92vh] overflow-y-auto">
        {/* Drag handle — tap to close on mobile */}
        <button
          onClick={onClose}
          className="w-full pt-3 pb-1 flex justify-center"
          aria-label="Close"
        >
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </button>

        <div className="px-5 pb-8 pt-2">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-1">
                Strain Breakdown
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-gray-900">{totalStrain}</span>
                <span className="text-sm text-gray-400">/ 21</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white ${BAND_BG[label]}`}>
                  {label.charAt(0).toUpperCase() + label.slice(1)}
                </span>
              </div>
            </div>
            {/* Donut ring */}
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: donut }}
            >
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-base font-black text-gray-900">
                {totalStrain}
              </div>
            </div>
          </div>

          {/* Workout bar */}
          <div className="mb-4">
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-sm font-semibold text-gray-800">Workout load</span>
              <span className="text-sm font-bold text-blue-600">
                {(Math.round(c.workoutPts * 10) / 10).toFixed(1)}
                <span className="text-xs font-normal text-gray-400"> / 14 pts</span>
              </span>
            </div>
            <div className="h-2 bg-blue-50 rounded-full mb-1.5">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (c.workoutPts / 14) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-400">
              {activitySummary ?? (c.workoutLoad > 0 ? `${Math.round(c.workoutLoad)} TSS` : 'no activity recorded')}
            </p>
          </div>

          <div className="border-t border-gray-100 mb-4" />

          {/* Wellbeing bar */}
          <div>
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-sm font-semibold text-gray-800">Wellbeing</span>
              <span className="text-sm font-bold text-amber-500">
                {(Math.round(c.lifePts * 10) / 10).toFixed(1)}
                <span className="text-xs font-normal text-gray-400"> / 7 pts</span>
              </span>
            </div>
            <div className="h-2 bg-amber-50 rounded-full mb-3">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (c.lifePts / 7) * 100)}%`,
                  background: 'linear-gradient(90deg, #f59e0b, #fb923c)',
                }}
              />
            </div>

            {/* Sub-signal rows */}
            <div className="space-y-2.5 pl-1">
              {/* Stress */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.stressAvg != null ? 'bg-amber-400' : 'bg-gray-200'}`} />
                {c.stressAvg != null ? (
                  <span className="text-xs text-gray-700">
                    Stress{' '}
                    <span className="text-gray-400">
                      avg {c.stressAvg}{c.stressHigh != null ? ` · peak ${c.stressHigh}` : ''}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Stress <em>not synced</em></span>
                )}
              </div>
              {/* Sleep */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.sleepScore != null ? 'bg-violet-400' : 'bg-gray-200'}`} />
                {c.sleepScore != null ? (
                  <span className="text-xs text-gray-700">
                    Sleep <span className="text-gray-400">score {c.sleepScore} / 100</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Sleep <em>not synced</em></span>
                )}
              </div>
              {/* Body battery */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.bodyBatteryLow != null ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                {c.bodyBatteryLow != null ? (
                  <span className="text-xs text-gray-700">
                    Body battery <span className="text-gray-400">woke at {c.bodyBatteryLow}%</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Body battery <em>not synced</em></span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```
git add components/StrainBreakdownSheet.tsx
git commit -m "feat: add StrainBreakdownSheet component"
```

---

## Task 3 — Make the strain band tappable in `MetricsBar`

**Files:**
- Modify: `components/MetricsBar.tsx`

Add an optional `onStrainTap` prop. When provided and `strainCategory` is non-null, the strain band gets a pointer cursor and calls `onStrainTap` on click.

- [ ] **Step 1: Add `onStrainTap` to the MetricsBar props and wire it up**

In `components/MetricsBar.tsx`, update the props destructuring (current line ~54):

```typescript
export default function MetricsBar({
  wellness,
  syncedAt = null,
  stale = {},
  embedded = false,
  lastRideLabel,
  onStrainTap,
}: {
  wellness: ICUWellness | null
  syncedAt?: Date | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  lastRideLabel?: string
  onStrainTap?: () => void
}) {
```

Then change the coloured strain band `div` (the one with `BAND_BG[strainCategory]`, currently ~line 79):

```typescript
          <div
            className={`flex items-center justify-between px-4 py-3.5 ${BAND_BG[strainCategory]}${onStrainTap ? ' cursor-pointer active:opacity-90' : ''}`}
            onClick={onStrainTap}
          >
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```
git add components/MetricsBar.tsx
git commit -m "feat: add onStrainTap prop to MetricsBar strain band"
```

---

## Task 4 — Wire everything in `app/dashboard/page.tsx`

**Files:**
- Modify: `app/dashboard/page.tsx`

Three changes: (1) import the sheet + add state, (2) build `activitySummary` near the other `todayStr` calculations, (3) pass `onStrainTap` to MetricsBar and render the sheet.

- [ ] **Step 1: Add import and state**

Add `StrainBreakdownSheet` to the imports at the top of the file (after the existing component imports):

```typescript
import StrainBreakdownSheet from '@/components/StrainBreakdownSheet'
```

Add the state variable near the other `useState` declarations (around line 76, with `feedbackWorkout`):

```typescript
const [strainSheetOpen, setStrainSheetOpen] = useState(false)
```

- [ ] **Step 2: Build `activitySummary`**

Add after the existing `todayActivityLoad` / `latestWellnessWithLoad` block (around line 337–340):

```typescript
const todayActivities = (syncData?.activities ?? []).filter((a: ICUActivity) =>
  a.start_date_local.startsWith(todayStr)
)
const activitySummary: string | undefined = todayActivities.length > 0
  ? todayActivities.map((a: ICUActivity) => a.name).filter(Boolean).join(' · ') || undefined
  : undefined
```

- [ ] **Step 3: Pass `onStrainTap` to MetricsBar and render the sheet**

Update the MetricsBar usage (around line 415):

```typescript
          <MetricsBar
            wellness={latestWellnessWithLoad}
            syncedAt={lastSyncedAt}
            stale={wellnessStale}
            embedded
            lastRideLabel={lastRide ? formatLastRide() : undefined}
            onStrainTap={() => setStrainSheetOpen(true)}
          />
```

Add the sheet render near the other modals at the bottom of the return (alongside `FeedbackModal`, `WorkoutDetailModal`, etc.):

```typescript
      {strainSheetOpen && latestWellnessWithLoad && (
        <StrainBreakdownSheet
          wellness={latestWellnessWithLoad}
          activitySummary={activitySummary}
          onClose={() => setStrainSheetOpen(false)}
        />
      )}
```

- [ ] **Step 4: Typecheck**

```
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Run tests**

```
npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```
git add app/dashboard/page.tsx
git commit -m "feat: wire strain breakdown sheet on dashboard"
```

---

## Verification Checklist

1. Open the dashboard — strain band has a pointer cursor when a score is shown
2. Tap the strain band — bottom sheet slides up
3. Sheet shows two bars: Workout (blue, 0–14) and Wellbeing (amber, 0–7)
4. Sheet shows three sub-signal rows under Wellbeing; rows without data show greyed "not synced"
5. Donut ring in top-right fills proportionally with blue/amber/violet/green segments
6. Tapping the scrim (behind the sheet) dismisses it
7. Tapping the drag handle at the top dismisses it
8. When `dailyStrain` is null (no strain data), no tap behaviour on the strain band (it falls through to the grey "Fitness Stats" header which has no `onStrainTap`)
9. On desktop (sm+), sheet centres rather than anchoring to bottom
