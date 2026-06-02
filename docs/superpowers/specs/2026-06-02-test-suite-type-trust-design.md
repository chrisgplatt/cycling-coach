# Test-Suite Type Trust — Design Spec

**Date:** 2026-06-02
**Status:** Approved (pending implementation plan)
**Theme:** Polish & trust — make the green checkmark mean something.

---

## Problem

The Jest suite reports **51 suites / 334 tests passing**, yet `tsc --noEmit` reports
**18 type errors across 13 test files**. The two disagree because `next/jest` runs tests
through SWC, which strips TypeScript types without checking them. Tests therefore "pass"
while their fixtures have silently drifted out of sync with the production types.

Each time a required field was added to a core type, the fixtures fell out of date but
nothing failed:

- `Workout.activity_metrics` (added; missing from many `Workout` fixtures)
- `TrainingPlan.plan_weeks` (added; missing from plan fixtures)
- `RidingStats.power_1min` (added; missing from stats fixtures)
- `ActivityMetrics.decoupling_pct | climbs | time_in_zone | shape` (Tier-4 fields added)
- `GeneratedPlan.workouts[].steps` (added; missing from generated-plan literals)

The trust gap: **the green checkmark is lying.** Type-level regressions in tests go
completely uncaught, and the drift compounds with every new required field.

> Note: a prior memory note claimed "~20 Jest *runtime* failures are baseline." That is
> incorrect — Jest runtime is green. The real issue is type drift invisible to Jest. The
> memory will be corrected.

---

## Goal

1. Bring `tsc --noEmit` to **zero** errors while keeping Jest green (334 passing).
2. Make the fixtures **resistant to future drift** — adding a required field should touch
   one place, not 13 files.
3. Add a **gate** so type drift fails automatically going forward.

Non-goals (explicitly out of scope): adding new behavioural test coverage for
coaching/scheduling paths (a possible follow-on), running ESLint in CI, and any change to
production (`app/`, `lib/`, `components/`) code — those already type-check cleanly.

---

## Architecture

Three units, each with a single responsibility:

1. **Fixture factories** (`__tests__/support/factories.ts`) — typed builders that produce
   complete, valid domain objects with `Partial<T>` overrides. The single source of truth
   for fixture shape.
2. **Refactored test files** — the 13 drifted files consume the factories (for drift) or
   are fixed at the call site (for genuine logic-type issues).
3. **The gate** — a `typecheck` npm script plus a GitHub Actions workflow that runs
   typecheck + tests on every push/PR.

### Why factories

A factory centralises the "complete valid object" so each test specifies only the fields it
cares about:

```ts
makeWorkout({ status: 'completed', tss: 85 })
```

When a new required field lands on `Workout`, only `makeWorkout`'s default changes — every
consumer keeps compiling. This is the durability mechanism that prevents the drift from
recurring inside the fixtures themselves.

---

## Component 1 — `__tests__/support/factories.ts`

A test-only module (never imported by app code).

**Jest must not run it as a test.** `next/jest`'s default `testMatch` treats every file
under `__tests__/` as a test, so `jest.config.ts` gains one line:

```ts
testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/__tests__/support/'],
```

(The `node_modules` entry preserves the Jest default, which is otherwise overridden.)

**Builders** (one per drifted core type), each returning a fully-typed object with valid
defaults and a trailing `...overrides`:

| Factory | Returns | Notable defaults to include |
|---------|---------|-----------------------------|
| `makeWorkout(overrides?)` | `Workout` | `activity_metrics: null`, `steps: null`, `tss: null`, `status: 'planned'` |
| `makeActivityMetrics(overrides?)` | `ActivityMetrics` | all four Tier-4 fields (`decoupling_pct`, `climbs`, `time_in_zone`, `shape`) present, defaulting to `null` |
| `makeTrainingPlan(overrides?)` | `TrainingPlan` | `plan_weeks` present (e.g. `8`), `last_reviewed_week: null` |
| `makeRidingStats(overrides?)` | `RidingStats` | `power_1min: null`, `cross_training: []`, `recent_rides: []` |
| `makeGeneratedWorkout(overrides?)` | `GeneratedPlan['workouts'][number]` | `steps: []` (or a minimal valid step array) |

Signature pattern:

```ts
export function makeWorkout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: 'w1',
    plan_id: 'p1',
    date: '2026-05-01',
    type: 'endurance',
    duration_minutes: 60,
    description: 'Steady endurance ride',
    target_zones: 'Z2 endurance',
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
```

The other factories follow the same shape against their respective interfaces in
`types/index.ts`.

---

## Component 2 — Refactor the 13 drifted files

The 18 errors fall into three buckets:

**A. Fixture drift (~16 errors)** — object literals missing newly-required fields. Replace
the literal with the matching factory call.

Affected files:
- `__tests__/app/stats/page.test.tsx` (`RidingStats` → `makeRidingStats`)
- `__tests__/components/FeedbackModal.test.tsx` (`Workout` → `makeWorkout`)
- `__tests__/components/RescheduleConfirmModal.test.tsx` (`Workout`)
- `__tests__/components/WorkoutCard.test.tsx` (`Workout`)
- `__tests__/components/WorkoutDetailModal.test.tsx` (`Workout`)
- `__tests__/lib/activity-metrics.test.ts` (`ActivityMetrics` → `makeActivityMetrics`)
- `__tests__/lib/chat-prompt.test.ts` (`Workout`)
- `__tests__/lib/claude-briefing.test.ts` (`Workout`)
- `__tests__/lib/claude-feedback.test.ts` (`Workout`)
- `__tests__/lib/claude-plan.test.ts` (`GeneratedPlan` workout → `makeGeneratedWorkout`)
- `__tests__/lib/review.test.ts` (`Workout`)
- `__tests__/lib/session-chat.test.ts` (`Workout` and `TrainingPlan`)

**B. Genuine test-logic type issues (~2 errors)** — not fixture drift. Fix at the access
site, not with a factory:
- `__tests__/lib/synthesize-dossier.test.ts(81)` — indexing a possibly-empty tuple / a
  possibly-`undefined` object. Resolve with a guard or a justified non-null assertion that
  matches the test's intent.

**Guiding rule:** factories carry the *defaults*; each test still overrides the fields its
assertions depend on, so test intent stays explicit and readable. No test's behavioural
meaning changes — only the fixture construction.

**End state:** `tsc --noEmit` → 0 errors; `jest` → 334 passing (unchanged).

---

## Component 3 — The gate

### npm scripts (package.json)

```jsonc
"typecheck": "tsc --noEmit",
"test:ci": "npm run typecheck && npm test"
```

`typecheck` is the single source of truth for the type gate; `test:ci` chains it ahead of
Jest for local/CI use.

### GitHub Actions — `.github/workflows/ci.yml`

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

- Node 24 matches the local toolchain; `package-lock.json` is present so `npm ci` is valid.
- CI runs **typecheck + test only**. ESLint is deliberately excluded to avoid a flood of
  unrelated warnings turning CI red on day one; lint-in-CI is a separate future decision.

---

## Data flow

```
types/index.ts  ──(shape)──▶  __tests__/support/factories.ts
                                        │
                                        ▼ (valid fixtures, Partial overrides)
                              13 refactored test files
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                         ▼
            npm run typecheck (tsc --noEmit)            npm test (jest)
                    │                                         │
                    └──────────────► CI (ci.yml) ◄───────────┘
                          fails the build on drift
```

---

## Verification

1. `npm run typecheck` → **0 errors** (was 18).
2. `npm test` → **334 passing**, unchanged.
3. Push a branch → the `verify` job runs and is green.
4. Deliberately break one fixture's types → CI goes **red** (proves the gate catches drift),
   then revert.

---

## Risks & mitigations

- **Factory defaults masking intent** — mitigated by requiring each test to override the
  fields its assertions read, rather than relying on defaults for meaningful values.
- **`testPathIgnorePatterns` accidentally hiding real tests** — the pattern is scoped to
  `__tests__/support/` only; all existing tests live elsewhere under `__tests__/`.
- **CI Node drift from local** — pinned to Node 24 with npm caching; revisit if the project
  adopts an `engines` field.

---

## Follow-on (not in this spec)

Once the suite is green *and* type-safe, an optional later plan can add behavioural coverage
for the highest-risk untested logic: the scheduling hard rules (no workouts on rest/event
days, duration ceilings), step-sum correctness, and feedback adaptation.
