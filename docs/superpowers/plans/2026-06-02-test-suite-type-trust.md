# Test-Suite Type Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `tsc --noEmit` to zero errors by routing test fixtures through typed factories, then add a CI gate so type drift can never silently return.

**Architecture:** A single test-only factory module (`__tests__/support/factories.ts`) produces complete, valid domain objects with `Partial<T>` overrides. The 13 drifted test files are refactored onto those factories (or fixed at the call site for genuine logic-type issues). A `typecheck` npm script plus a GitHub Actions workflow run `tsc --noEmit` + `jest` on every push/PR.

**Tech Stack:** TypeScript 5, Jest (via `next/jest`/SWC), React Testing Library, GitHub Actions, Node 24.

**Spec:** `docs/superpowers/specs/2026-06-02-test-suite-type-trust-design.md`

**Key facts the engineer must know:**
- `next/jest` runs tests through SWC, which **strips types without checking them**. So `npm test` (Jest) passing tells you nothing about type correctness. `tsc --noEmit` is the only type gate.
- Today: `npm test` → **334 passing / 51 suites** (green). `npx tsc --noEmit` → **18 errors across 13 test files** (red). The end state is both green.
- The `@/` import alias maps to repo root (configured in `jest.config.ts` and `tsconfig.json`). Import types as `import type { Workout } from '@/types'`.
- Run all commands from the repo root: `C:\Users\chris\Claude_CP\Cycling Coach\cycling-coach`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `__tests__/support/factories.ts` | Typed fixture builders (single source of truth for fixture shape) | Create |
| `jest.config.ts` | Add `testPathIgnorePatterns` so the factory file isn't run as a test | Modify |
| `package.json` | Add `typecheck` + `test:ci` scripts | Modify |
| `.github/workflows/ci.yml` | CI gate: typecheck + test on push/PR | Create |
| 13 test files under `__tests__/` | Consume factories / fix logic-type issues | Modify |

The 13 drifted files (from `npx tsc --noEmit`):
- `__tests__/components/FeedbackModal.test.tsx` (`Workout`)
- `__tests__/components/RescheduleConfirmModal.test.tsx` (`Workout`)
- `__tests__/components/WorkoutCard.test.tsx` (`Workout`)
- `__tests__/components/WorkoutDetailModal.test.tsx` (`Workout`)
- `__tests__/lib/chat-prompt.test.ts` (`Workout`)
- `__tests__/lib/claude-briefing.test.ts` (`Workout`)
- `__tests__/lib/claude-feedback.test.ts` (`Workout`)
- `__tests__/lib/review.test.ts` (`Workout`)
- `__tests__/lib/session-chat.test.ts` (`Workout` + `TrainingPlan`)
- `__tests__/lib/activity-metrics.test.ts` (`ActivityMetrics`)
- `__tests__/app/stats/page.test.tsx` (`RidingStats`)
- `__tests__/lib/claude-plan.test.ts` (`GeneratedPlan` nested workout)
- `__tests__/lib/synthesize-dossier.test.ts` (genuine logic-type issue, not drift)

---

## Task 1: Add the typecheck gate scripts and capture the baseline

**Files:**
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Capture the current error baseline**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | Select-String "error TS" | Measure-Object | Select-Object -ExpandProperty Count` (PowerShell)
Expected: `18`

Run: `npm test`
Expected: `Tests: 334 passed, 334 total`

- [ ] **Step 2: Add the scripts**

In `package.json`, the `scripts` block is currently:

```json
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build --webpack",
    "start": "next start",
    "lint": "eslint",
    "test": "jest"
  },
```

Change it to:

```json
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build --webpack",
    "start": "next start",
    "lint": "eslint",
    "test": "jest",
    "typecheck": "tsc --noEmit",
    "test:ci": "npm run typecheck && npm test"
  },
```

- [ ] **Step 3: Confirm the script reproduces the baseline**

Run: `npm run typecheck`
Expected: prints 18 `error TS...` lines, all under `__tests__/`, then exits non-zero. (This is expected — Task 2 onward drives it to zero.)

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add typecheck and test:ci npm scripts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Create the typed fixture factories

**Files:**
- Create: `__tests__/support/factories.ts`
- Modify: `jest.config.ts`

- [ ] **Step 1: Stop Jest from running the factory file as a test**

`next/jest`'s default `testMatch` treats every file under `__tests__/` as a test. Without this, Jest would try to run `factories.ts` and fail with "Your test suite must contain at least one test."

In `jest.config.ts`, the config object is:

```ts
const config: Config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
}
```

Add a `testPathIgnorePatterns` key (the `node_modules` entry preserves Jest's default, which is otherwise replaced):

```ts
const config: Config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/__tests__/support/'],
}
```

- [ ] **Step 2: Create the factory module**

Create `__tests__/support/factories.ts` with the exact contents below. Every default field is taken from the current interfaces in `types/index.ts`; each builder returns a complete, valid object and accepts a `Partial<T>` override.

```ts
import type {
  Workout,
  ActivityMetrics,
  TrainingPlan,
  RidingStats,
  GeneratedPlan,
} from '@/types'

export function makeWorkout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: 'w1',
    plan_id: 'p1',
    date: '2026-05-01',
    type: 'endurance',
    duration_minutes: 60,
    description: 'Steady endurance ride',
    target_zones: 'Zone 2 (55-75% FTP)',
    intervals_icu_event_id: null,
    status: 'planned',
    icu_activity_id: null,
    tss: null,
    missed_reason: null,
    steps: null,
    activity_metrics: null,
    created_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

export function makeActivityMetrics(overrides: Partial<ActivityMetrics> = {}): ActivityMetrics {
  return {
    np: 230,
    avg_power: 215,
    max_power: 600,
    avg_hr: 148,
    distance_m: 30000,
    elevation_m: 300,
    lr_balance: 50,
    best_efforts: null,
    intervals: null,
    decoupling_pct: null,
    climbs: null,
    time_in_zone: null,
    shape: null,
    synced_at: '2026-05-01T10:00:00Z',
    ...overrides,
  }
}

export function makeTrainingPlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: 'plan1',
    name: 'Test Plan',
    status: 'active',
    target_event_name: 'Target Event',
    target_event_date: '2026-07-01',
    phase: 'build',
    rationale: 'Progressive build towards the A event.',
    last_reviewed_week: null,
    plan_weeks: 8,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

export function makeRidingStats(overrides: Partial<RidingStats> = {}): RidingStats {
  return {
    ride_count: 0,
    total_distance_km: 0,
    total_elevation_m: 0,
    total_duration_secs: 0,
    power_1min: null,
    power_5min: null,
    power_10min: null,
    power_20min: null,
    avg_left_right_balance: null,
    balance_ride_count: 0,
    recent_rides: [],
    cross_training: [],
    ...overrides,
  }
}

export function makeGeneratedWorkout(
  overrides: Partial<GeneratedPlan['workouts'][number]> = {},
): GeneratedPlan['workouts'][number] {
  return {
    date: '2026-05-13',
    type: 'endurance',
    duration_minutes: 90,
    description: 'Easy Zone 2 ride',
    target_zones: 'Zone 2 (55-75% FTP)',
    steps: [],
    ...overrides,
  }
}
```

- [ ] **Step 3: Verify the factory module type-checks and Jest ignores it**

Run: `npm run typecheck`
Expected: still 18 errors, **all under `__tests__/` test files** — and **none** referencing `__tests__/support/factories.ts`. (The factory file itself compiles cleanly; it just isn't used yet.)

Run: `npm test`
Expected: `Tests: 334 passed` — and the suite count stays **51** (the support file is not picked up as a 52nd suite).

- [ ] **Step 4: Commit**

```bash
git add __tests__/support/factories.ts jest.config.ts
git commit -m "test: add typed fixture factories and ignore support dir

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Refactor the `Workout` fixtures (8 files)

**Files (all Modify):**
- `__tests__/components/FeedbackModal.test.tsx`
- `__tests__/components/RescheduleConfirmModal.test.tsx`
- `__tests__/components/WorkoutCard.test.tsx`
- `__tests__/components/WorkoutDetailModal.test.tsx`
- `__tests__/lib/chat-prompt.test.ts`
- `__tests__/lib/claude-briefing.test.ts`
- `__tests__/lib/claude-feedback.test.ts`
- `__tests__/lib/review.test.ts`

> `__tests__/lib/session-chat.test.ts` also has a `Workout` fixture but is handled in Task 4 (it also has a `TrainingPlan` fixture).

**The mechanical transform:** each file declares a `Workout` object literal that is now missing the required `activity_metrics` field (and the error message names the exact line). Replace the literal with a `makeWorkout({...})` call carrying only the fields that test's assertions depend on. Do **not** change any assertion or test name — only the fixture construction.

- [ ] **Step 1: Refactor `WorkoutCard.test.tsx` (worked example)**

Current (lines 1-12):

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import WorkoutCard from '@/components/WorkoutCard'
import type { Workout } from '@/types'

const workout: Workout = {
  id: 'w1', plan_id: 'p1', date: '2026-05-15',
  type: 'threshold', duration_minutes: 60,
  description: '2x20min at threshold', target_zones: 'Zone 4 (91-105% FTP)',
  intervals_icu_event_id: null, status: 'planned',
  icu_activity_id: null, tss: null, missed_reason: null, steps: null,
  created_at: '',
}
```

Replace with:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import WorkoutCard from '@/components/WorkoutCard'
import { makeWorkout } from '../support/factories'

const workout = makeWorkout({
  date: '2026-05-15',
  type: 'threshold',
  description: '2x20min at threshold',
  target_zones: 'Zone 4 (91-105% FTP)',
})
```

Notes:
- The import path is relative (`../support/factories`) — from `__tests__/components/` that resolves to `__tests__/support/factories`. From `__tests__/lib/` it is also `../support/factories`. From `__tests__/app/stats/` it is `../../support/factories`.
- Drop the now-unused `import type { Workout }` if the file no longer references the `Workout` type elsewhere. If TypeScript reports `'Workout' is declared but never used`, remove it.
- Keep every override the assertions rely on. `WorkoutCard` asserts on type/duration/status, so `type` and `description` are kept; `duration_minutes` defaults to 60 which matches the existing `/60/` assertion, so it may be omitted or kept explicitly — keep it explicit (`duration_minutes: 60`) for clarity if the test asserts on it.

- [ ] **Step 2: Refactor the remaining 7 files the same way**

For each file: find the `const ...: Workout = { ... }` literal at the line named in the tsc error, replace it with `makeWorkout({ ...only-the-asserted-fields })`, update the import to `import { makeWorkout } from '<relative>/support/factories'`, and remove a now-unused `import type { Workout }` if present. Where a file derives variants via spread (e.g. `{ ...workout, status: 'completed' }`), leave those spreads as-is — they still work because `workout` is now a complete object.

Per-file specifics:
- `FeedbackModal.test.tsx`, `RescheduleConfirmModal.test.tsx`, `WorkoutDetailModal.test.tsx`: same shape as the worked example. `RescheduleConfirmModal` and `WorkoutDetailModal` fixtures set `intervals_icu_event_id` to a string — preserve that as an override (`intervals_icu_event_id: 'evt1'`).
- `chat-prompt.test.ts`, `claude-briefing.test.ts`, `claude-feedback.test.ts`, `review.test.ts`: these pass the workout into prompt-builder functions. Preserve every field the builder reads and the assertions check (e.g. `claude-briefing` sets `status: 'completed'`, `icu_activity_id`, `tss` — keep those as overrides).

- [ ] **Step 3: Verify the error count dropped**

Run: `npm run typecheck`
Expected: error count is now **lower than 18** and no remaining error points at any of the 8 files refactored in this task.

Run: `npm test`
Expected: `Tests: 334 passed`. (Behaviour unchanged — only fixture construction moved.)

- [ ] **Step 4: Commit**

```bash
git add __tests__/components/FeedbackModal.test.tsx __tests__/components/RescheduleConfirmModal.test.tsx __tests__/components/WorkoutCard.test.tsx __tests__/components/WorkoutDetailModal.test.tsx __tests__/lib/chat-prompt.test.ts __tests__/lib/claude-briefing.test.ts __tests__/lib/claude-feedback.test.ts __tests__/lib/review.test.ts
git commit -m "test: route Workout fixtures through makeWorkout factory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Refactor `session-chat.test.ts` (`Workout` + `TrainingPlan`)

**Files:**
- Modify: `__tests__/lib/session-chat.test.ts`

- [ ] **Step 1: Replace both fixtures with factories**

Current (lines 1-39):

```ts
import { buildSessionSystemPrompt } from '@/lib/claude/session-chat'
import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
import type { Workout, TrainingPlan, ICUWellness } from '@/types'

const workout: Workout = {
  id: 'wk-today',
  plan_id: 'plan1',
  date: '2026-05-24',
  type: 'threshold',
  duration_minutes: 60,
  description: '2x20min at threshold',
  target_zones: 'Zone 4 (91-105% FTP)',
  intervals_icu_event_id: null,
  status: 'planned',
  icu_activity_id: null,
  tss: null,
  missed_reason: null,
  steps: null,
  created_at: '',
}

const plan: TrainingPlan = {
  id: 'plan1',
  name: 'Gran Fondo Build',
  status: 'active',
  target_event_name: 'Etape du Tour',
  target_event_date: '2026-07-10',
  phase: 'build',
  rationale: 'Progressive build towards A event',
  last_reviewed_week: null,
  created_at: '',
  updated_at: '',
}

const upcoming: Workout[] = [
  { ...workout, id: 'wk-thu', date: '2026-05-27', type: 'endurance', duration_minutes: 90,
    description: 'Zone 2 ride', status: 'planned' },
]
```

Replace with:

```ts
import { buildSessionSystemPrompt } from '@/lib/claude/session-chat'
import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
import type { ICUWellness } from '@/types'
import { makeWorkout, makeTrainingPlan } from '../support/factories'

const workout = makeWorkout({
  id: 'wk-today',
  date: '2026-05-24',
  type: 'threshold',
  description: '2x20min at threshold',
  target_zones: 'Zone 4 (91-105% FTP)',
})

const plan = makeTrainingPlan({
  name: 'Gran Fondo Build',
  target_event_name: 'Etape du Tour',
  target_event_date: '2026-07-10',
  rationale: 'Progressive build towards A event',
})

const upcoming = [
  makeWorkout({ id: 'wk-thu', date: '2026-05-27', type: 'endurance', duration_minutes: 90,
    description: 'Zone 2 ride' }),
]
```

Note: keep `ICUWellness` in the type import (still used elsewhere in the file). Remove `Workout` and `TrainingPlan` from the type import since the factories now provide them.

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: no error references `__tests__/lib/session-chat.test.ts`; total count drops by 2.

Run: `npx jest __tests__/lib/session-chat.test.ts`
Expected: PASS (all tests in the file green).

- [ ] **Step 3: Commit**

```bash
git add __tests__/lib/session-chat.test.ts
git commit -m "test: route session-chat fixtures through factories

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Refactor `activity-metrics.test.ts` (`ActivityMetrics`)

**Files:**
- Modify: `__tests__/lib/activity-metrics.test.ts`

The errors are at lines 68, 81, 88, 103 — object literals passed to `formatActivityMetrics`/`formatRideExecution` that are missing the Tier-4 fields (`decoupling_pct`, `climbs`, `time_in_zone`, `shape`).

- [ ] **Step 1: Add the factory import**

At the top of the file, add:

```ts
import { makeActivityMetrics } from '../support/factories'
```

- [ ] **Step 2: Replace the `base` fixture (around line 60)**

Current:

```ts
  const base = {
    np: 248, avg_power: 231, max_power: 612, avg_hr: 152,
    distance_m: 32500, elevation_m: 84, lr_balance: 51,
    best_efforts: [{ secs: 300, watts: 312 }, { secs: 1200, watts: 264 }],
    intervals: null, synced_at: '2026-05-28T09:00:00Z',
  }
```

Replace with:

```ts
  const base = makeActivityMetrics({
    np: 248, avg_power: 231, max_power: 612, avg_hr: 152,
    distance_m: 32500, elevation_m: 84, lr_balance: 51,
    best_efforts: [{ secs: 300, watts: 312 }, { secs: 1200, watts: 264 }],
    synced_at: '2026-05-28T09:00:00Z',
  })
```

The `{ ...base, max_power: null, ... }` spread at line 81 needs no change — `base` is now a complete `ActivityMetrics`.

- [ ] **Step 3: Replace the all-null "fallback" fixture (around line 88)**

Current:

```ts
    const s = formatActivityMetrics({
      np: null, avg_power: null, max_power: null, avg_hr: null, distance_m: null,
      elevation_m: null, lr_balance: null, best_efforts: null, intervals: null,
      synced_at: '2026-05-28T09:00:00Z',
    })
```

Replace with (Tier-4 fields default to `null` in the factory, so only the displayable fields need nulling):

```ts
    const s = formatActivityMetrics(makeActivityMetrics({
      np: null, avg_power: null, max_power: null, avg_hr: null, distance_m: null,
      elevation_m: null, lr_balance: null, best_efforts: null, intervals: null,
    }))
```

- [ ] **Step 4: Replace the `metricsWithIntervals` fixture (around line 103)**

Current:

```ts
  const metricsWithIntervals: ActivityMetrics = {
    np: 248, avg_power: 231, max_power: 612, avg_hr: 152, distance_m: 32500,
    elevation_m: 84, lr_balance: 51, best_efforts: null,
    intervals: [
      { label: 'Warm Up', duration_secs: 602, avg_watts: 142, avg_hr: 120 },
      { label: 'Work', duration_secs: 480, avg_watts: 244, avg_hr: 161 },
    ],
```

Replace the opening of the literal (keep the existing `intervals` array and any trailing fields, just close the `makeActivityMetrics(...)` call where the literal closed):

```ts
  const metricsWithIntervals = makeActivityMetrics({
    np: 248, avg_power: 231, max_power: 612, avg_hr: 152, distance_m: 32500,
    elevation_m: 84, lr_balance: 51, best_efforts: null,
    intervals: [
      { label: 'Warm Up', duration_secs: 602, avg_watts: 142, avg_hr: 120 },
      { label: 'Work', duration_secs: 480, avg_watts: 244, avg_hr: 161 },
    ],
```

Then change the literal's closing `}` to `})`. If the now-unused `import type { ActivityMetrics }` remains and tsc flags it as unused, remove it (keep `WorkoutStep` and any other still-used type imports).

- [ ] **Step 5: Verify**

Run: `npx jest __tests__/lib/activity-metrics.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no error references `__tests__/lib/activity-metrics.test.ts` (4 fewer errors).

- [ ] **Step 6: Commit**

```bash
git add __tests__/lib/activity-metrics.test.ts
git commit -m "test: route ActivityMetrics fixtures through factory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Refactor `stats/page.test.tsx` (`RidingStats`)

**Files:**
- Modify: `__tests__/app/stats/page.test.tsx`

The error (line 6) is the `mockStats: RidingStats` literal missing `power_1min`. The literal is large (it embeds full `recent_rides` objects), so the cleanest fix is to **wrap the existing literal in `makeRidingStats(...)`** — passing the whole body as the override. The factory supplies `power_1min: null`; nothing else needs to move.

- [ ] **Step 1: Add the factory import**

The path from `__tests__/app/stats/` is `../../support/factories`:

```tsx
import { makeRidingStats } from '../../support/factories'
```

- [ ] **Step 2: Wrap the literal**

Change the opening line (line 6) from:

```tsx
const mockStats: RidingStats = {
```

to:

```tsx
const mockStats = makeRidingStats({
```

…and change the literal's matching closing brace from `}` to `})`. Every existing field stays exactly as-is inside the override; `power_1min` is filled by the factory. If tsc then flags `import type { RidingStats }` as unused, remove it.

- [ ] **Step 3: Verify**

Run: `npx jest __tests__/app/stats/page.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: no error references `__tests__/app/stats/page.test.tsx`.

- [ ] **Step 4: Commit**

```bash
git add __tests__/app/stats/page.test.tsx
git commit -m "test: route RidingStats fixture through factory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Refactor `claude-plan.test.ts` (`GeneratedPlan` nested workout)

**Files:**
- Modify: `__tests__/lib/claude-plan.test.ts`

The error (line 39) is a nested workout literal inside `validPlan.workouts` missing the required `steps` field.

- [ ] **Step 1: Replace the nested workout literal with `makeGeneratedWorkout`**

Current (lines 33-47):

```ts
const validPlan: GeneratedPlan = {
  rationale: 'Base phase focusing on aerobic development.',
  target_event_name: 'Dragon Ride',
  target_event_date: '2026-06-21',
  phase: 'base',
  workouts: [
    {
      date: '2026-05-13',
      type: 'endurance',
      duration_minutes: 90,
      description: 'Easy Zone 2 ride',
      target_zones: 'Zone 2 (55-75% FTP)',
    },
  ],
}
```

Replace with:

```ts
const validPlan: GeneratedPlan = {
  rationale: 'Base phase focusing on aerobic development.',
  target_event_name: 'Dragon Ride',
  target_event_date: '2026-06-21',
  phase: 'base',
  workouts: [
    makeGeneratedWorkout({
      date: '2026-05-13',
      type: 'endurance',
      duration_minutes: 90,
      description: 'Easy Zone 2 ride',
      target_zones: 'Zone 2 (55-75% FTP)',
    }),
  ],
}
```

Add the import:

```ts
import { makeGeneratedWorkout } from '../support/factories'
```

Keep the `import type { GeneratedPlan }` — it is still used to type `validPlan`.

- [ ] **Step 2: Verify**

Run: `npx jest __tests__/lib/claude-plan.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no error references `__tests__/lib/claude-plan.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add __tests__/lib/claude-plan.test.ts
git commit -m "test: route generated-plan workout fixture through factory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Fix the genuine logic-type issue in `synthesize-dossier.test.ts`

**Files:**
- Modify: `__tests__/lib/synthesize-dossier.test.ts`

This is **not** fixture drift. At line 81 the test reads `upsertSpy.mock.calls[0][0].explicit_notes`, but the spy is declared as `jest.fn(() => ...)` with no parameter types, so its `mock.calls` element type is the empty tuple `[]` — indexing `[0][0]` produces TS2493 ("tuple of length 0 has no element at index 0") and TS2532 ("object is possibly undefined").

- [ ] **Step 1: Type the spy's parameter and use optional chaining**

Find the `upsertSpy` used by the test at line 81 (declared a few lines above, around line 75):

```ts
    const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
```

Change it to give the call a typed argument:

```ts
    const upsertSpy = jest.fn((_row?: Record<string, unknown>) => Promise.resolve({ error: null }))
```

Then change the assertion at line 81 from:

```ts
    expect(upsertSpy.mock.calls[0][0].explicit_notes).toEqual([])
```

to:

```ts
    expect(upsertSpy.mock.calls[0]?.[0]?.explicit_notes).toEqual([])
```

Now `mock.calls[0]?.[0]` is `Record<string, unknown> | undefined` and `?.explicit_notes` is `unknown`, which `toEqual([])` accepts. The assertion still fails loudly if the call never happened (the value would be `undefined`, not `[]`).

- [ ] **Step 2: Verify**

Run: `npx jest __tests__/lib/synthesize-dossier.test.ts`
Expected: PASS (including the "defaults explicit_notes to []" test).

Run: `npm run typecheck`
Expected: **0 errors** — `Select-String "error TS"` returns nothing and the command exits 0. This is the last drifted file.

- [ ] **Step 3: Commit**

```bash
git add __tests__/lib/synthesize-dossier.test.ts
git commit -m "test: type upsert spy arg to fix tuple-index type error

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Add the GitHub Actions CI gate

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [master]
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```

Scope note: CI runs typecheck + test only. ESLint is intentionally excluded (per the spec) to avoid unrelated lint warnings turning CI red on day one.

- [ ] **Step 2: Locally dry-run what CI will run**

Run: `npm run test:ci`
Expected: typecheck prints nothing and exits 0, then `Tests: 334 passed, 334 total`.

- [ ] **Step 3: Commit and push to a branch to exercise CI**

```bash
git checkout -b ci/typecheck-gate
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions typecheck + test gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push -u origin ci/typecheck-gate
```

- [ ] **Step 4: Confirm the gate is green, then prove it catches drift**

Run: `gh run watch` (or check the Actions tab on GitHub).
Expected: the `verify` job passes (typecheck + test green).

Then prove the gate works: open any refactored test file, temporarily add a bogus required-field violation (e.g. `makeWorkout({ duration_minutes: 'sixty' })`), run `npm run typecheck` locally.
Expected: typecheck **fails** with a type error — confirming drift is now caught. Revert the bogus change.

---

## Task 10: Final verification and merge

**Files:** none (verification + integration)

- [ ] **Step 1: Full local gate**

Run: `npm run typecheck`
Expected: 0 errors, exit 0.

Run: `npm test`
Expected: `Test Suites: 51 passed, 51 total` and `Tests: 334 passed, 334 total`.

- [ ] **Step 2: Open a PR (or merge per the team's convention)**

Use the finishing-a-development-branch workflow to merge `ci/typecheck-gate` into `master`. The CI gate must be green on the PR before merge.

- [ ] **Step 3: Confirm the gate runs on `master`**

After merge, confirm the `CI` workflow runs on the push to `master` and is green.

---

## Self-Review Notes

- **Spec coverage:** factories module + jest ignore (Tasks 1-2) ✓; refactor all 13 drifted files to zero tsc errors (Tasks 3-8) ✓; `typecheck` + `test:ci` scripts (Task 1) ✓; GitHub Actions gate, typecheck+test only, Node 24, `npm ci` (Task 9) ✓; verification incl. deliberate-break proof (Tasks 9-10) ✓. Follow-on behavioural coverage is explicitly out of scope (spec) and not planned here ✓.
- **Factory/type consistency:** the five factory names (`makeWorkout`, `makeActivityMetrics`, `makeTrainingPlan`, `makeRidingStats`, `makeGeneratedWorkout`) are used identically in every consuming task. Defaults match the current `types/index.ts` field lists (`Workout.activity_metrics`, `TrainingPlan.plan_weeks`, `RidingStats.power_1min`, the four Tier-4 `ActivityMetrics` fields, `GeneratedPlan.workouts[].steps`).
- **Relative import paths:** `__tests__/components/*` and `__tests__/lib/*` → `../support/factories`; `__tests__/app/stats/*` → `../../support/factories`. Stated where each applies.
```
