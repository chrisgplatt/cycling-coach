# Athlete Response Model — Plan 1 of 3: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the data layer, the grounded calculations, and the prompt formatter for a persistent, structured model of how this athlete responds to training.

**Architecture:** A new `athlete_beliefs` table (one active row per `(user_id, key)`, history inline in a `revisions` array). Three pure, hand-computed "grounding" functions distil real training data into traceable numbers (ramp tolerance, RPE calibration, recovery). A `formatAthleteModel` formatter renders active beliefs into a prompt block (mirrors `formatDossier`). This plan ships pure, unit-tested library code and the schema — no synthesis or UI yet (Plans 2 and 3).

**Tech Stack:** TypeScript (strict), Supabase (Postgres + RLS), Jest (SWC). The real type gate is `npm run typecheck`; Jest skips types.

**Spec:** `docs/superpowers/specs/2026-06-05-athlete-response-model-design.md`

---

## Context for the implementer

- This is a **single-athlete** PWA. Conventions: tables use `create table if not exists`, `user_id uuid not null references auth.users(id) on delete cascade`, and a single RLS policy `create policy "own data" on <table> using (user_id = auth.uid()) with check (user_id = auth.uid());`. Mirror these exactly.
- Confidence enums elsewhere use `check (confidence in ('high','medium','low'))` (see `ftp_predictions`).
- The dossier is the sibling concept: `lib/claude/dossier.ts` holds `fetchDossier` + `formatDossier`. Mirror that file's shape for the new formatter.
- Pure data-analysis code that must stay free of the Supabase/Anthropic SDKs lives in plain modules (see `lib/claude/activity-metrics.ts`, `lib/ride/planned-actual.ts`). The grounding functions follow that rule — no imports beyond `@/types`.
- Run a single test file with: `npx jest <path>` (use the PowerShell tool on this Windows box; judge pass/fail by the `Tests:` / `Test Suites:` summary lines, not stray `NativeCommandError` wrapper text).

## File structure

- Create: `supabase/migrations/20260605_athlete_beliefs.sql` — the table + RLS.
- Modify: `supabase/schema.sql` — mirror the table and its RLS line.
- Modify: `types/index.ts` — belief types.
- Create: `lib/athlete-model/grounding.ts` — the three pure grounding functions.
- Create: `lib/claude/athlete-model.ts` — `fetchActiveBeliefs` + `formatAthleteModel`.
- Create: `__tests__/lib/athlete-model-grounding.test.ts`
- Create: `__tests__/lib/athlete-model-format.test.ts`

---

## Task 1: Schema — `athlete_beliefs` table

**Files:**
- Create: `supabase/migrations/20260605_athlete_beliefs.sql`
- Modify: `supabase/schema.sql` (append the table after the existing tables, and add its RLS lines beside the others)

There is no automated DB test here; correctness is verified by the SQL applying cleanly and matching conventions. This task is schema-only.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260605_athlete_beliefs.sql`:

```sql
-- Athlete Response Model: structured, accumulating beliefs about how this athlete
-- responds to training. One ACTIVE row per (user_id, key); prior versions are kept
-- inline in `revisions` so there is no second history table.
create table if not exists athlete_beliefs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  key            text not null,                 -- stable id e.g. 'ramp_tolerance'
  label          text not null,                 -- human title
  value_text     text not null,                 -- plain-language claim (shown + prompted)
  value_data     jsonb,                          -- optional structured numbers
  confidence     text not null default 'low' check (confidence in ('low','medium','high')),
  evidence       text not null default '',       -- short "based on…" citation
  source         text not null default 'ai' check (source in ('ai','athlete','computed')),
  status         text not null default 'active'
                   check (status in ('active','confirmed','corrected','dismissed','superseded')),
  first_observed timestamptz not null default now(),
  last_updated   timestamptz not null default now(),
  last_confirmed timestamptz,
  revisions      jsonb not null default '[]',    -- BeliefRevision[]
  contradiction  jsonb,                          -- BeliefContradiction | null
  unique (user_id, key)
);

alter table athlete_beliefs enable row level security;
create policy "own data" on athlete_beliefs
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: Mirror into `supabase/schema.sql`**

Add the same `create table if not exists athlete_beliefs (...)` block alongside the other table definitions, add `alter table athlete_beliefs enable row level security;` to the RLS block, and add `create policy "own data" on athlete_beliefs using (user_id = auth.uid()) with check (user_id = auth.uid());` to the policies block. Use the identical column definitions from Step 1.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260605_athlete_beliefs.sql supabase/schema.sql
git commit -m "feat: athlete_beliefs table for the response model"
```

---

## Task 2: Types

**Files:**
- Modify: `types/index.ts` (append near the other domain types)

- [ ] **Step 1: Add the belief types**

Append to `types/index.ts`:

```ts
export type BeliefConfidence = 'low' | 'medium' | 'high'
export type BeliefSource = 'ai' | 'athlete' | 'computed'
export type BeliefStatus = 'active' | 'confirmed' | 'corrected' | 'dismissed' | 'superseded'

export interface BeliefRevision {
  value_text: string
  confidence: BeliefConfidence
  evidence: string
  revised_at: string   // ISO timestamp
  reason: string       // why it changed
}

export interface BeliefContradiction {
  observed: string     // what fresh evidence suggests, conflicting with an athlete-set belief
  noted_at: string     // ISO timestamp
}

export interface AthleteBelief {
  id: string
  user_id: string
  key: string
  label: string
  value_text: string
  value_data: Record<string, unknown> | null
  confidence: BeliefConfidence
  evidence: string
  source: BeliefSource
  status: BeliefStatus
  first_observed: string
  last_updated: string
  last_confirmed: string | null
  revisions: BeliefRevision[]
  contradiction: BeliefContradiction | null
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: exit 0 (no errors).

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: athlete belief types"
```

---

## Task 3: Grounding — weekly ramp tolerance

**Files:**
- Create: `lib/athlete-model/grounding.ts`
- Create: `__tests__/lib/athlete-model-grounding.test.ts`

The estimate of the athlete's personal weekly TSS ramp ceiling: the typical week-over-week increase they **absorbed and kept building from** (a ramp not followed by a back-off the next week). Honest and traceable; the synthesis layer (Plan 2) assigns confidence from the sample size.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/athlete-model-grounding.test.ts`:

```ts
import { computeRampTolerance } from '@/lib/athlete-model/grounding'

describe('computeRampTolerance', () => {
  it('returns null below four weeks of data', () => {
    expect(computeRampTolerance([300, 320, 340])).toBeNull()
  })

  it('estimates the sustained week-over-week ramp the athlete kept building from', () => {
    // +10%, +10% (both held the following week), then a ramp that BACKED OFF.
    // Sustained ramps are the two +10%s → median 10.
    const out = computeRampTolerance([300, 330, 363, 399, 300])!
    expect(out.pct).toBe(10)
    expect(out.weeks).toBe(5)
  })

  it('falls back to the median positive ramp when none were sustained', () => {
    // Every ramp is followed by a drop → no sustained ramps; median of +20,+25 ≈ 23.
    const out = computeRampTolerance([200, 240, 200, 250, 200])!
    expect(out.pct).toBe(23)
  })

  it('ignores weeks following a zero/blank week', () => {
    const out = computeRampTolerance([0, 300, 330, 363])!
    expect(out.pct).toBe(10)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/lib/athlete-model-grounding.test.ts`
Expected: FAIL — `computeRampTolerance is not a function`.

- [ ] **Step 3: Implement**

Create `lib/athlete-model/grounding.ts`:

```ts
// Pure, dependency-free training-data calculations that ground the response model
// in real numbers. No Supabase/Anthropic imports — assembled inputs in, plain
// numbers out, so they are trivially unit-testable and traceable.

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface RampTolerance { pct: number; weeks: number }

// Weekly TSS in chronological order. Estimate the personal week-over-week ramp the
// athlete absorbed and kept building from (a ramp where the FOLLOWING week did not
// fall back below ~95% of the ramped week). Falls back to the median positive ramp.
export function computeRampTolerance(weeklyTss: number[]): RampTolerance | null {
  if (weeklyTss.length < 4) return null
  const ramps: Array<{ pct: number; sustained: boolean }> = []
  for (let i = 1; i < weeklyTss.length; i++) {
    const prev = weeklyTss[i - 1]
    if (prev <= 0) continue
    const pct = ((weeklyTss[i] - prev) / prev) * 100
    if (pct <= 0) continue
    const sustained = i + 1 < weeklyTss.length && weeklyTss[i + 1] >= weeklyTss[i] * 0.95
    ramps.push({ pct, sustained })
  }
  if (!ramps.length) return null
  const sustained = ramps.filter(r => r.sustained).map(r => r.pct)
  const pool = sustained.length ? sustained : ramps.map(r => r.pct)
  return { pct: Math.round(median(pool)), weeks: weeklyTss.length }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/lib/athlete-model-grounding.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/athlete-model/grounding.ts __tests__/lib/athlete-model-grounding.test.ts
git commit -m "feat: grounded weekly ramp tolerance calculation"
```

---

## Task 4: Grounding — RPE calibration

**Files:**
- Modify: `lib/athlete-model/grounding.ts`
- Modify: `__tests__/lib/athlete-model-grounding.test.ts`

How the athlete's reported RPE compares to the RPE a session's prescribed intensity would normally warrant. Positive bias = over-rates effort; negative = under-rates. Split easy (≤75% FTP) vs hard (≥91% FTP) when each has enough sessions.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/athlete-model-grounding.test.ts`:

```ts
import { computeRpeCalibration, expectedRpe } from '@/lib/athlete-model/grounding'

describe('expectedRpe', () => {
  it('maps prescribed %FTP to a normal RPE', () => {
    expect(expectedRpe(50)).toBe(2)   // recovery
    expect(expectedRpe(70)).toBe(4)   // endurance
    expect(expectedRpe(85)).toBe(5)   // tempo
    expect(expectedRpe(100)).toBe(7)  // threshold
    expect(expectedRpe(115)).toBe(8.5)// vo2
    expect(expectedRpe(130)).toBe(9.5)// anaerobic
  })
})

describe('computeRpeCalibration', () => {
  it('returns null below five rated sessions', () => {
    const s = [
      { rpe: 7, targetPct: 100 }, { rpe: 7, targetPct: 100 },
      { rpe: 7, targetPct: 100 }, { rpe: 7, targetPct: 100 },
    ]
    expect(computeRpeCalibration(s)).toBeNull()
  })

  it('reports an overall bias and splits easy vs hard when each has enough', () => {
    // Endurance rated 1 point HIGH (5 vs expected 4); threshold rated 1 LOW (6 vs 7).
    const s = [
      { rpe: 5, targetPct: 70 }, { rpe: 5, targetPct: 70 }, { rpe: 5, targetPct: 70 },
      { rpe: 6, targetPct: 100 }, { rpe: 6, targetPct: 100 }, { rpe: 6, targetPct: 100 },
    ]
    const out = computeRpeCalibration(s)!
    expect(out.n).toBe(6)
    expect(out.easyBias).toBe(1)   // +1 on easy
    expect(out.hardBias).toBe(-1)  // -1 on hard
    expect(out.overall).toBe(0)    // they cancel
  })

  it('omits a split with fewer than three sessions', () => {
    const s = [
      { rpe: 5, targetPct: 70 }, { rpe: 5, targetPct: 70 }, { rpe: 5, targetPct: 70 },
      { rpe: 5, targetPct: 70 }, { rpe: 6, targetPct: 100 },
    ]
    const out = computeRpeCalibration(s)!
    expect(out.easyBias).toBe(1)
    expect(out.hardBias).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/lib/athlete-model-grounding.test.ts`
Expected: FAIL — `computeRpeCalibration is not a function` / `expectedRpe is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/athlete-model/grounding.ts`:

```ts
// The RPE a session's prescribed intensity would normally warrant (1–10), using the
// CLAUDE.md zone boundaries on %FTP.
export function expectedRpe(targetPct: number): number {
  if (targetPct < 55) return 2
  if (targetPct <= 75) return 4
  if (targetPct <= 90) return 5
  if (targetPct <= 105) return 7
  if (targetPct <= 120) return 8.5
  return 9.5
}

export interface RpeCalibration {
  overall: number            // mean(reported − expected), 1dp; + = over-rates
  easyBias: number | null    // for sessions ≤75% FTP, if ≥3
  hardBias: number | null    // for sessions ≥91% FTP, if ≥3
  n: number
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
const round1 = (x: number): number => Math.round(x * 10) / 10

export function computeRpeCalibration(
  sessions: Array<{ rpe: number; targetPct: number }>,
): RpeCalibration | null {
  const rated = sessions.filter(s => Number.isFinite(s.rpe) && Number.isFinite(s.targetPct))
  if (rated.length < 5) return null
  const diff = (s: { rpe: number; targetPct: number }) => s.rpe - expectedRpe(s.targetPct)
  const easy = rated.filter(s => s.targetPct <= 75)
  const hard = rated.filter(s => s.targetPct >= 91)
  return {
    overall: round1(mean(rated.map(diff))),
    easyBias: easy.length >= 3 ? round1(mean(easy.map(diff))) : null,
    hardBias: hard.length >= 3 ? round1(mean(hard.map(diff))) : null,
    n: rated.length,
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/lib/athlete-model-grounding.test.ts`
Expected: PASS (all grounding tests).

- [ ] **Step 5: Commit**

```bash
git add lib/athlete-model/grounding.ts __tests__/lib/athlete-model-grounding.test.ts
git commit -m "feat: grounded RPE calibration calculation"
```

---

## Task 5: Grounding — recovery profile

**Files:**
- Modify: `lib/athlete-model/grounding.ts`
- Modify: `__tests__/lib/athlete-model-grounding.test.ts`

How the athlete copes the day after a hard session: the share of next-day sessions completed well, and their average feel. Input is the athlete's sessions in chronological order with a hard flag, a completed-well flag, and an optional feel (1=fresh … 5=empty).

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/athlete-model-grounding.test.ts`:

```ts
import { computeRecoveryProfile } from '@/lib/athlete-model/grounding'

describe('computeRecoveryProfile', () => {
  const day = (n: number) => `2026-05-${String(n).padStart(2, '0')}`

  it('returns null with fewer than three post-hard days', () => {
    const sessions = [
      { date: day(1), isHard: true, completedWell: true, feel: 2 },
      { date: day(2), isHard: false, completedWell: true, feel: 2 },
    ]
    expect(computeRecoveryProfile(sessions)).toBeNull()
  })

  it('measures completion and feel on days immediately after a hard day', () => {
    const sessions = [
      { date: day(1), isHard: true, completedWell: true, feel: 3 },
      { date: day(2), isHard: false, completedWell: true, feel: 2 },  // post-hard, good
      { date: day(3), isHard: true, completedWell: true, feel: 3 },
      { date: day(4), isHard: false, completedWell: false, feel: 4 }, // post-hard, cut short
      { date: day(5), isHard: true, completedWell: true, feel: 3 },
      { date: day(6), isHard: false, completedWell: true, feel: 3 },  // post-hard, good
    ]
    const out = computeRecoveryProfile(sessions)!
    expect(out.n).toBe(3)
    expect(out.nextDayCompletionRate).toBe(67) // 2 of 3
    expect(out.nextDayAvgFeel).toBe(3)         // (2+4+3)/3
  })

  it('only counts the immediately-following calendar day', () => {
    const sessions = [
      { date: day(1), isHard: true, completedWell: true, feel: 3 },
      { date: day(3), isHard: false, completedWell: true, feel: 2 }, // 2-day gap → not post-hard
      { date: day(10), isHard: true, completedWell: true, feel: 3 },
      { date: day(11), isHard: false, completedWell: false, feel: 4 },
      { date: day(12), isHard: true, completedWell: true, feel: 3 },
      { date: day(13), isHard: false, completedWell: true, feel: 2 },
      { date: day(20), isHard: true, completedWell: true, feel: 3 },
      { date: day(21), isHard: false, completedWell: true, feel: 2 },
    ]
    const out = computeRecoveryProfile(sessions)!
    expect(out.n).toBe(3) // days 11, 13, 21
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/lib/athlete-model-grounding.test.ts`
Expected: FAIL — `computeRecoveryProfile is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/athlete-model/grounding.ts`:

```ts
export interface RecoveryProfile {
  nextDayCompletionRate: number    // % of post-hard days completed well
  nextDayAvgFeel: number | null    // mean feel on post-hard days (1 fresh … 5 empty)
  n: number
}

// Sessions in chronological order. A "post-hard day" is one whose date is exactly the
// calendar day after a hard session. Dates are 'YYYY-MM-DD'.
export function computeRecoveryProfile(
  sessions: Array<{ date: string; isHard: boolean; completedWell: boolean; feel: number | null }>,
): RecoveryProfile | null {
  const prevDay = (d: string): string => {
    const t = new Date(d + 'T00:00:00Z')
    t.setUTCDate(t.getUTCDate() - 1)
    return t.toISOString().slice(0, 10)
  }
  const hardDates = new Set(sessions.filter(s => s.isHard).map(s => s.date))
  const postHard = sessions.filter(s => hardDates.has(prevDay(s.date)))
  if (postHard.length < 3) return null
  const feels = postHard.map(s => s.feel).filter((v): v is number => v != null)
  return {
    nextDayCompletionRate: Math.round(
      (postHard.filter(s => s.completedWell).length / postHard.length) * 100,
    ),
    nextDayAvgFeel: feels.length ? Math.round((feels.reduce((a, b) => a + b, 0) / feels.length) * 10) / 10 : null,
    n: postHard.length,
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/lib/athlete-model-grounding.test.ts`
Expected: PASS (all grounding tests).

- [ ] **Step 5: Commit**

```bash
git add lib/athlete-model/grounding.ts __tests__/lib/athlete-model-grounding.test.ts
git commit -m "feat: grounded recovery profile calculation"
```

---

## Task 6: `fetchActiveBeliefs` + `formatAthleteModel`

**Files:**
- Create: `lib/claude/athlete-model.ts`
- Create: `__tests__/lib/athlete-model-format.test.ts`

Mirrors `lib/claude/dossier.ts` (`fetchDossier` + `formatDossier`). The formatter renders active, non-dismissed beliefs into a prompt block; athlete-confirmed/corrected beliefs are framed as athlete-stated truth; an empty/all-dismissed set yields `''`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/athlete-model-format.test.ts`:

```ts
import { formatAthleteModel } from '@/lib/claude/athlete-model'
import type { AthleteBelief } from '@/types'

function belief(over: Partial<AthleteBelief>): AthleteBelief {
  return {
    id: 'b1', user_id: 'u1', key: 'ramp_tolerance', label: 'Weekly ramp tolerance',
    value_text: 'Absorbs about +8% TSS/week before HRV suppresses.',
    value_data: null, confidence: 'high', evidence: 'Last 3 build blocks',
    source: 'ai', status: 'active', first_observed: '2026-01-01T00:00:00Z',
    last_updated: '2026-06-01T00:00:00Z', last_confirmed: null, revisions: [], contradiction: null,
    ...over,
  }
}

describe('formatAthleteModel', () => {
  it('returns empty string for no beliefs', () => {
    expect(formatAthleteModel([])).toBe('')
  })

  it('renders a labelled block with confidence', () => {
    const out = formatAthleteModel([belief({})])
    expect(out).toContain('WHAT THE COACH HAS LEARNED ABOUT THIS ATHLETE')
    expect(out).toContain('Weekly ramp tolerance')
    expect(out).toContain('+8% TSS/week')
    expect(out).toContain('(high confidence)')
  })

  it('frames athlete-confirmed and corrected beliefs as athlete-stated', () => {
    const out = formatAthleteModel([
      belief({ status: 'confirmed', source: 'athlete' }),
      belief({ key: 'recovery', label: 'Recovery', status: 'corrected', source: 'athlete', value_text: 'Recovers fast.' }),
    ])
    expect(out).toContain('athlete confirms')
    expect(out).toContain('athlete states')
  })

  it('excludes dismissed beliefs', () => {
    const out = formatAthleteModel([
      belief({}),
      belief({ key: 'recovery', label: 'Recovery', status: 'dismissed', value_text: 'SHOULD NOT APPEAR' }),
    ])
    expect(out).not.toContain('SHOULD NOT APPEAR')
  })

  it('returns empty string when every belief is dismissed', () => {
    expect(formatAthleteModel([belief({ status: 'dismissed' })])).toBe('')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/lib/athlete-model-format.test.ts`
Expected: FAIL — `formatAthleteModel is not a function`.

- [ ] **Step 3: Implement**

Create `lib/claude/athlete-model.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AthleteBelief } from '@/types'

// Active, non-dismissed beliefs for a user (mirrors fetchDossier).
export async function fetchActiveBeliefs(
  supabase: SupabaseClient,
  userId: string,
): Promise<AthleteBelief[]> {
  const { data } = await supabase
    .from('athlete_beliefs')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'dismissed')
    .order('confidence', { ascending: false })
  return (data as AthleteBelief[] | null) ?? []
}

const CONFIDENCE_LABEL: Record<AthleteBelief['confidence'], string> = {
  high: 'high confidence', medium: 'medium confidence', low: 'low confidence',
}

// Render active beliefs into a prompt block. Athlete-set beliefs (confirmed/corrected)
// are framed as ground truth that outranks inference. Dismissed beliefs are dropped;
// an empty or all-dismissed set yields '' so prompts are unchanged when the model is
// empty.
export function formatAthleteModel(beliefs: AthleteBelief[]): string {
  const shown = beliefs.filter(b => b.status !== 'dismissed')
  if (!shown.length) return ''
  const lines = shown.map(b => {
    let prefix = ''
    if (b.status === 'confirmed') prefix = '[athlete confirms] '
    else if (b.status === 'corrected') prefix = '[athlete states] '
    return `- ${b.label}: ${prefix}${b.value_text} (${CONFIDENCE_LABEL[b.confidence]})`
  })
  return ['WHAT THE COACH HAS LEARNED ABOUT THIS ATHLETE:', ...lines].join('\n')
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/lib/athlete-model-format.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck the whole change**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/claude/athlete-model.ts __tests__/lib/athlete-model-format.test.ts
git commit -m "feat: fetchActiveBeliefs + formatAthleteModel"
```

---

## Done criteria

- `athlete_beliefs` migration + schema mirror in place.
- Belief types exported from `@/types`.
- Three grounded calculations (`computeRampTolerance`, `computeRpeCalibration` + `expectedRpe`, `computeRecoveryProfile`) implemented and unit-tested.
- `fetchActiveBeliefs` + `formatAthleteModel` implemented and unit-tested.
- `npm run typecheck` clean; full `npx jest` green.

## What comes next (not this plan)

- **Plan 2 — Synthesis & reconciliation:** assemble the grounded inputs from the DB, generate the belief set via Claude, reconcile/accumulate into `athlete_beliefs` (sticky athlete beliefs, contradiction flagging, confidence decay), and hook it into the dossier cron.
- **Plan 3 — Surface & wiring:** `GET/PATCH /api/athlete-model`, the `AthleteModel` coach-page section (confirm/correct/dismiss), and wiring `formatAthleteModel` into `lib/claude/plan.ts` and `lib/claude/briefing.ts`.
