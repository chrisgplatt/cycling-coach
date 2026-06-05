# Athlete Response Model — Plan 2 of 3: Synthesis & Reconciliation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate and *accumulate* the `athlete_beliefs` table: assemble real training data into the grounded calculations, turn the results into beliefs, reconcile them against what's already stored (sticky athlete edits, contradiction flagging, confidence decay), and run it from the existing nightly cron.

**Architecture:** A deterministic pipeline — `assemble` (DB rows → grounding inputs) → `grounding` (Plan 1) → `build-beliefs` (results → candidate beliefs) → `reconcile` (candidates + stored beliefs → upserts). An orchestrator `synthesizeBeliefs` wires it to Supabase, mirroring `synthesize-dossier.ts`. **No Claude call** — the grounded beliefs are templated in code, so the whole pipeline is pure and unit-testable. AI-estimated soft beliefs (affinities, FTP-movers) are deferred to a later add-on.

**Tech Stack:** TypeScript (strict), Supabase (Postgres), Jest (SWC). Real type gate: `npm run typecheck`. Windows — use the PowerShell tool for `npx jest`/`npm`; judge pass/fail by the `Tests:` summary line.

**Depends on:** Plan 1 (the `athlete_beliefs` table, the `AthleteBelief`/`Belief*` types, and `lib/athlete-model/grounding.ts`). **Spec:** `docs/superpowers/specs/2026-06-05-athlete-response-model-design.md`.

---

## Context for the implementer

- Plan 1 shipped `lib/athlete-model/grounding.ts` exporting: `computeRampTolerance(weeklyTss: number[]): { pct, weeks } | null`, `computeRpeCalibration(sessions: {rpe,targetPct}[]): { overall, easyBias, hardBias, n } | null`, `expectedRpe`, and `computeRecoveryProfile(sessions: {date,isHard,completedWell,feel}[]): { nextDayCompletionRate, nextDayAvgFeel, n } | null`. Import these — do not reimplement.
- The `AthleteBelief` type and friends (`BeliefConfidence`, `BeliefStatus`, `BeliefRevision`, `BeliefContradiction`) are in `@/types`.
- `WorkoutType` is `'endurance' | 'threshold' | 'intervals' | 'recovery'` (in `@/types`). `FeedbackCompletion` is `'as_planned' | 'cut_short' | 'went_harder' | 'modified'` (in `@/types`).
- The orchestrator mirrors `lib/claude/synthesize-dossier.ts` (read it): same `(supabase, profile/userId)` shape, parallel `supabase.from(...).select(...)` reads, then a write. The cron that calls it is `app/api/cron/dossier/route.ts`.
- All pure modules import only from `@/types` and Plan 1's grounding — no Supabase/Anthropic.
- `now` (an ISO timestamp) is always **passed in** to pure functions, never read from `Date.now()` inside them, so tests are deterministic.

## File structure

- Create: `lib/athlete-model/assemble.ts` — DB rows → grounding inputs (pure).
- Create: `lib/athlete-model/build-beliefs.ts` — grounding results → `CandidateBelief[]` (pure).
- Create: `lib/athlete-model/reconcile.ts` — candidates + stored beliefs → upserts (pure).
- Create: `lib/claude/synthesize-beliefs.ts` — the orchestrator (Supabase).
- Modify: `app/api/cron/dossier/route.ts` — call `synthesizeBeliefs` alongside `synthesizeDossier`.
- Tests: `__tests__/lib/athlete-model-assemble.test.ts`, `__tests__/lib/athlete-model-build.test.ts`, `__tests__/lib/athlete-model-reconcile.test.ts`, `__tests__/lib/synthesize-beliefs.test.ts`.

---

## Task 1: Assembly — weekly TSS series

**Files:**
- Create: `lib/athlete-model/assemble.ts`
- Create: `__tests__/lib/athlete-model-assemble.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/athlete-model-assemble.test.ts`:

```ts
import { weeklyTssSeries } from '@/lib/athlete-model/assemble'

describe('weeklyTssSeries', () => {
  it('buckets workouts into Monday-started weeks and sums TSS chronologically', () => {
    // 2026-05-04 is a Monday. 05-04..05-10 = week 1; 05-11..05-17 = week 2.
    const series = weeklyTssSeries([
      { date: '2026-05-04', tss: 50 },
      { date: '2026-05-06', tss: 60 },
      { date: '2026-05-10', tss: 40 },   // still week 1 (Sunday)
      { date: '2026-05-11', tss: 70 },   // week 2 (Monday)
      { date: '2026-05-13', tss: 80 },
    ])
    expect(series).toEqual([150, 150])
  })

  it('treats null TSS as zero and orders weeks ascending regardless of input order', () => {
    const series = weeklyTssSeries([
      { date: '2026-05-13', tss: 80 },
      { date: '2026-05-04', tss: null },
      { date: '2026-05-06', tss: 60 },
    ])
    expect(series).toEqual([60, 80])
  })

  it('returns [] for no workouts', () => {
    expect(weeklyTssSeries([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/lib/athlete-model-assemble.test.ts`
Expected: FAIL — `weeklyTssSeries is not a function`.

- [ ] **Step 3: Implement**

Create `lib/athlete-model/assemble.ts`:

```ts
// Pure transforms from stored DB rows into the inputs the grounding calculations
// expect. No Supabase/Anthropic imports — the orchestrator owns the fetching.
import type { WorkoutType, FeedbackCompletion } from '@/types'

// Monday (UTC) of the week containing date 'YYYY-MM-DD'.
function mondayOf(date: string): string {
  const t = new Date(date + 'T00:00:00Z')
  const dow = (t.getUTCDay() + 6) % 7 // 0 = Monday
  t.setUTCDate(t.getUTCDate() - dow)
  return t.toISOString().slice(0, 10)
}

// Weekly TSS totals in chronological order. Null TSS counts as 0.
export function weeklyTssSeries(workouts: Array<{ date: string; tss: number | null }>): number[] {
  const byWeek = new Map<string, number>()
  for (const w of workouts) {
    const wk = mondayOf(w.date)
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + (w.tss ?? 0))
  }
  return [...byWeek.keys()].sort().map(k => byWeek.get(k)!)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/lib/athlete-model-assemble.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/athlete-model/assemble.ts __tests__/lib/athlete-model-assemble.test.ts
git commit -m "feat: assemble weekly TSS series from workouts"
```

(Every commit message in this plan must end with the trailer:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never stage `.claude/settings.local.json`. Commit on master.)

---

## Task 2: Assembly — RPE sessions (type → target intensity)

**Files:**
- Modify: `lib/athlete-model/assemble.ts`
- Modify: `__tests__/lib/athlete-model-assemble.test.ts`

Each workout type maps to a representative prescribed intensity (%FTP), so a session's reported RPE can be compared to what that intensity normally warrants.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/athlete-model-assemble.test.ts`:

```ts
import { rpeSessionsFromFeedback, TYPE_TARGET_PCT } from '@/lib/athlete-model/assemble'

describe('rpeSessionsFromFeedback', () => {
  it('maps each rated session to its type target intensity', () => {
    const out = rpeSessionsFromFeedback([
      { rpe: 4, type: 'endurance' },
      { rpe: 8, type: 'intervals' },
    ])
    expect(out).toEqual([
      { rpe: 4, targetPct: TYPE_TARGET_PCT.endurance },
      { rpe: 8, targetPct: TYPE_TARGET_PCT.intervals },
    ])
  })

  it('drops rows with no RPE or no type', () => {
    const out = rpeSessionsFromFeedback([
      { rpe: null, type: 'threshold' },
      { rpe: 7, type: null },
      { rpe: 6, type: 'threshold' },
    ])
    expect(out).toEqual([{ rpe: 6, targetPct: TYPE_TARGET_PCT.threshold }])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/lib/athlete-model-assemble.test.ts`
Expected: FAIL — `rpeSessionsFromFeedback is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/athlete-model/assemble.ts`:

```ts
// Representative prescribed intensity (%FTP) per workout type — the midpoint of the
// type's working zone, used to judge whether a reported RPE was high or low for the
// session that was set.
export const TYPE_TARGET_PCT: Record<WorkoutType, number> = {
  recovery: 52,
  endurance: 68,
  threshold: 98,
  intervals: 112,
}

export function rpeSessionsFromFeedback(
  rows: Array<{ rpe: number | null; type: WorkoutType | null }>,
): Array<{ rpe: number; targetPct: number }> {
  return rows
    .filter((r): r is { rpe: number; type: WorkoutType } => r.rpe != null && r.type != null)
    .map(r => ({ rpe: r.rpe, targetPct: TYPE_TARGET_PCT[r.type] }))
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/lib/athlete-model-assemble.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/athlete-model/assemble.ts __tests__/lib/athlete-model-assemble.test.ts
git commit -m "feat: assemble RPE-vs-target sessions from feedback"
```

---

## Task 3: Assembly — recovery sessions

**Files:**
- Modify: `lib/athlete-model/assemble.ts`
- Modify: `__tests__/lib/athlete-model-assemble.test.ts`

Turn workout+feedback rows into the recovery input: hard = threshold/intervals; completed-well comes from the feedback `completion` when present, else the workout `status`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/athlete-model-assemble.test.ts`:

```ts
import { recoverySessions, HARD_TYPES } from '@/lib/athlete-model/assemble'

describe('HARD_TYPES', () => {
  it('treats threshold and intervals as hard', () => {
    expect(HARD_TYPES.has('threshold')).toBe(true)
    expect(HARD_TYPES.has('intervals')).toBe(true)
    expect(HARD_TYPES.has('endurance')).toBe(false)
    expect(HARD_TYPES.has('recovery')).toBe(false)
  })
})

describe('recoverySessions', () => {
  it('flags hard sessions and derives completed-well from completion then status', () => {
    const out = recoverySessions([
      { date: '2026-05-04', type: 'intervals', status: 'completed', completion: 'as_planned', feel: 3 },
      { date: '2026-05-05', type: 'endurance', status: 'completed', completion: 'cut_short', feel: 4 },
      { date: '2026-05-06', type: 'recovery', status: 'completed', completion: null, feel: null },
      { date: '2026-05-07', type: 'threshold', status: 'skipped', completion: null, feel: null },
    ])
    expect(out).toEqual([
      { date: '2026-05-04', isHard: true, completedWell: true, feel: 3 },   // as_planned → well
      { date: '2026-05-05', isHard: false, completedWell: false, feel: 4 }, // cut_short → not well
      { date: '2026-05-06', isHard: false, completedWell: true, feel: null },// no completion → status completed
      { date: '2026-05-07', isHard: true, completedWell: false, feel: null },// no completion → status not completed
    ])
  })

  it('treats went_harder as completed well', () => {
    const out = recoverySessions([
      { date: '2026-05-04', type: 'intervals', status: 'needs_review', completion: 'went_harder', feel: 2 },
    ])
    expect(out[0].completedWell).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/lib/athlete-model-assemble.test.ts`
Expected: FAIL — `recoverySessions is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/athlete-model/assemble.ts`:

```ts
export const HARD_TYPES = new Set<WorkoutType>(['threshold', 'intervals'])

export function recoverySessions(
  rows: Array<{
    date: string; type: WorkoutType; status: string
    completion: FeedbackCompletion | null; feel: number | null
  }>,
): Array<{ date: string; isHard: boolean; completedWell: boolean; feel: number | null }> {
  return rows.map(r => ({
    date: r.date,
    isHard: HARD_TYPES.has(r.type),
    completedWell: r.completion != null
      ? r.completion === 'as_planned' || r.completion === 'went_harder'
      : r.status === 'completed',
    feel: r.feel,
  }))
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/lib/athlete-model-assemble.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/athlete-model/assemble.ts __tests__/lib/athlete-model-assemble.test.ts
git commit -m "feat: assemble recovery sessions from workouts and feedback"
```

---

## Task 4: Build grounded beliefs

**Files:**
- Create: `lib/athlete-model/build-beliefs.ts`
- Create: `__tests__/lib/athlete-model-build.test.ts`

Run the three grounding calculations on the assembled inputs and template each non-null result into a `CandidateBelief` (stable key, plain-language `value_text`, structured `value_data`, sample-size confidence, evidence string).

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/athlete-model-build.test.ts`:

```ts
import { buildGroundedBeliefs, confidenceFromCount } from '@/lib/athlete-model/build-beliefs'

describe('confidenceFromCount', () => {
  it('steps low → medium → high at the thresholds', () => {
    expect(confidenceFromCount(3, 4, 8)).toBe('low')
    expect(confidenceFromCount(4, 4, 8)).toBe('medium')
    expect(confidenceFromCount(8, 4, 8)).toBe('high')
  })
})

describe('buildGroundedBeliefs', () => {
  it('produces a belief per non-null grounding result with stable keys', () => {
    const beliefs = buildGroundedBeliefs({
      weeklyTss: [300, 330, 363, 399, 432, 300, 330, 363, 399, 432],
      rpeSessions: Array.from({ length: 12 }, () => ({ rpe: 5, targetPct: 70 })),
      recovery: Array.from({ length: 6 }, (_, i) => ({
        date: `2026-05-${String(i + 1).padStart(2, '0')}`, isHard: i % 2 === 0, completedWell: true, feel: 3,
      })),
    })
    const byKey = Object.fromEntries(beliefs.map(b => [b.key, b]))
    expect(Object.keys(byKey).sort()).toEqual(['ramp_tolerance', 'recovery', 'rpe_calibration'])
    expect(byKey.ramp_tolerance.source).toBe('computed')
    expect(byKey.ramp_tolerance.value_data).toHaveProperty('pct')
    expect(byKey.ramp_tolerance.value_text.length).toBeGreaterThan(0)
    expect(byKey.rpe_calibration.value_data).toMatchObject({ overall: 1 }) // rpe5 vs expected 4
    expect(['low', 'medium', 'high']).toContain(byKey.recovery.confidence)
  })

  it('omits a belief when its grounding result is null (insufficient data)', () => {
    const beliefs = buildGroundedBeliefs({
      weeklyTss: [300, 320],        // < 4 weeks → null
      rpeSessions: [],              // < 5 → null
      recovery: [],                 // < 3 → null
    })
    expect(beliefs).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/lib/athlete-model-build.test.ts`
Expected: FAIL — `buildGroundedBeliefs is not a function`.

- [ ] **Step 3: Implement**

Create `lib/athlete-model/build-beliefs.ts`:

```ts
import type { BeliefConfidence } from '@/types'
import { computeRampTolerance, computeRpeCalibration, computeRecoveryProfile } from './grounding'

// A belief the synthesis proposes this run, before reconciliation against stored state.
export interface CandidateBelief {
  key: string
  label: string
  value_text: string
  value_data: Record<string, unknown>
  confidence: BeliefConfidence
  evidence: string
  source: 'computed'
}

export function confidenceFromCount(n: number, medMin: number, highMin: number): BeliefConfidence {
  if (n >= highMin) return 'high'
  if (n >= medMin) return 'medium'
  return 'low'
}

export interface GroundingInputs {
  weeklyTss: number[]
  rpeSessions: Array<{ rpe: number; targetPct: number }>
  recovery: Array<{ date: string; isHard: boolean; completedWell: boolean; feel: number | null }>
}

const feelWord = (f: number): string => (f <= 2 ? 'fresh' : f <= 3 ? 'okay' : 'flat')

export function buildGroundedBeliefs(inputs: GroundingInputs): CandidateBelief[] {
  const out: CandidateBelief[] = []

  const ramp = computeRampTolerance(inputs.weeklyTss)
  if (ramp) {
    const where = ramp.pct < 8 ? 'below' : ramp.pct > 11 ? 'above' : 'around'
    out.push({
      key: 'ramp_tolerance',
      label: 'Weekly ramp tolerance',
      value_text: `Absorbs roughly +${ramp.pct}% TSS per week before backing off — ${where} the textbook 10%.`,
      value_data: { pct: ramp.pct, weeks: ramp.weeks },
      confidence: confidenceFromCount(ramp.weeks, 6, 10),
      evidence: `${ramp.weeks} weeks of load history`,
      source: 'computed',
    })
  }

  const rpe = computeRpeCalibration(inputs.rpeSessions)
  if (rpe) {
    const parts: string[] = []
    if (rpe.easyBias != null && Math.abs(rpe.easyBias) >= 0.5) {
      parts.push(`${rpe.easyBias > 0 ? 'over' : 'under'}-rates easy rides by ~${Math.abs(rpe.easyBias)}`)
    }
    if (rpe.hardBias != null && Math.abs(rpe.hardBias) >= 0.5) {
      parts.push(`${rpe.hardBias > 0 ? 'over' : 'under'}-rates hard efforts by ~${Math.abs(rpe.hardBias)}`)
    }
    const body = parts.length
      ? `Perceived effort ${parts.join('; ')} (RPE points).`
      : `Perceived effort tracks prescribed intensity closely (overall bias ${rpe.overall}).`
    out.push({
      key: 'rpe_calibration',
      label: 'RPE calibration',
      value_text: body,
      value_data: { overall: rpe.overall, easyBias: rpe.easyBias, hardBias: rpe.hardBias, n: rpe.n },
      confidence: confidenceFromCount(rpe.n, 8, 12),
      evidence: `${rpe.n} rated sessions`,
      source: 'computed',
    })
  }

  const rec = computeRecoveryProfile(inputs.recovery)
  if (rec) {
    const feelClause = rec.nextDayAvgFeel != null
      ? `, typically feeling ${feelWord(rec.nextDayAvgFeel)} (${rec.nextDayAvgFeel}/5)`
      : ''
    out.push({
      key: 'recovery',
      label: 'Recovery profile',
      value_text: `Completes ${rec.nextDayCompletionRate}% of sessions the day after a hard day${feelClause}.`,
      value_data: { nextDayCompletionRate: rec.nextDayCompletionRate, nextDayAvgFeel: rec.nextDayAvgFeel, n: rec.n },
      confidence: confidenceFromCount(rec.n, 4, 8),
      evidence: `${rec.n} post-hard days`,
      source: 'computed',
    })
  }

  return out
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/lib/athlete-model-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/athlete-model/build-beliefs.ts __tests__/lib/athlete-model-build.test.ts
git commit -m "feat: build grounded candidate beliefs from grounding results"
```

---

## Task 5: Reconcile candidates against stored beliefs

**Files:**
- Create: `lib/athlete-model/reconcile.ts`
- Create: `__tests__/lib/athlete-model-reconcile.test.ts`

The accumulation core. Given the stored beliefs and this run's candidates, produce the rows to upsert: new beliefs, consistent re-observations (confidence nudged up), contradictions (old pushed to `revisions`), athlete-set beliefs kept sticky (contradiction flagged, never overwritten), dismissed beliefs left alone, and stale beliefs decayed.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/athlete-model-reconcile.test.ts`:

```ts
import { reconcileBeliefs } from '@/lib/athlete-model/reconcile'
import type { AthleteBelief } from '@/types'
import type { CandidateBelief } from '@/lib/athlete-model/build-beliefs'

const NOW = '2026-06-05T03:00:00Z'

function stored(over: Partial<AthleteBelief>): AthleteBelief {
  return {
    id: 'x', user_id: 'u1', key: 'ramp_tolerance', label: 'Weekly ramp tolerance',
    value_text: 'old', value_data: { pct: 8, weeks: 8 }, confidence: 'medium', evidence: 'old',
    source: 'computed', status: 'active', first_observed: '2026-01-01T00:00:00Z',
    last_updated: '2026-05-01T00:00:00Z', last_confirmed: '2026-05-01T00:00:00Z',
    revisions: [], contradiction: null, ...over,
  }
}

function candidate(over: Partial<CandidateBelief>): CandidateBelief {
  return {
    key: 'ramp_tolerance', label: 'Weekly ramp tolerance', value_text: 'new',
    value_data: { pct: 8, weeks: 10 }, confidence: 'medium', evidence: '10 weeks', source: 'computed', ...over,
  }
}

describe('reconcileBeliefs', () => {
  it('creates a new active belief when none exists for the key', () => {
    const [row] = reconcileBeliefs([], [candidate({})], NOW)
    expect(row.key).toBe('ramp_tolerance')
    expect(row.status).toBe('active')
    expect(row.first_observed).toBe(NOW)
    expect(row.last_confirmed).toBe(NOW)
  })

  it('on consistent re-observation, keeps the value and nudges confidence up', () => {
    const [row] = reconcileBeliefs([stored({ confidence: 'low' })], [candidate({ value_data: { pct: 9, weeks: 10 }, confidence: 'low' })], NOW)
    expect(row.confidence).toBe('medium') // stepped up from low
    expect(row.last_confirmed).toBe(NOW)
    expect(row.revisions).toEqual([])
  })

  it('on contradicting evidence, revises and archives the old value into revisions', () => {
    const [row] = reconcileBeliefs([stored({ value_data: { pct: 8, weeks: 8 }, value_text: 'old' })],
      [candidate({ value_data: { pct: 15, weeks: 10 }, value_text: 'new' })], NOW)
    expect(row.value_text).toBe('new')
    expect(row.revisions).toHaveLength(1)
    expect(row.revisions![0].value_text).toBe('old')
  })

  it('never overwrites an athlete-confirmed belief; flags a contradiction instead', () => {
    const ex = stored({ status: 'confirmed', source: 'athlete', value_text: 'mine', value_data: { pct: 8, weeks: 8 } })
    const [row] = reconcileBeliefs([ex], [candidate({ value_data: { pct: 15, weeks: 10 }, value_text: 'new' })], NOW)
    expect(row.value_text).toBe('mine')          // unchanged
    expect(row.status).toBe('confirmed')
    expect(row.contradiction).toMatchObject({ observed: 'new' })
  })

  it('reaffirms an athlete belief and clears any prior contradiction when evidence agrees', () => {
    const ex = stored({ status: 'corrected', source: 'athlete', contradiction: { observed: 'stale', noted_at: '2026-05-01T00:00:00Z' } })
    const [row] = reconcileBeliefs([ex], [candidate({ value_data: { pct: 8, weeks: 10 } })], NOW)
    expect(row.contradiction).toBeNull()
    expect(row.last_confirmed).toBe(NOW)
  })

  it('leaves a dismissed belief untouched (no resurrection)', () => {
    const ex = stored({ status: 'dismissed' })
    const rows = reconcileBeliefs([ex], [candidate({})], NOW)
    expect(rows).toEqual([])
  })

  it('decays a stale AI belief but leaves an athlete belief already at its medium floor untouched', () => {
    const aiStale = stored({ key: 'recovery', confidence: 'medium', last_confirmed: '2026-04-01T00:00:00Z' })
    // Already at the medium floor → no change → not re-written.
    const athleteStale = stored({ key: 'rpe_calibration', status: 'confirmed', source: 'athlete', confidence: 'medium', last_confirmed: '2026-04-01T00:00:00Z' })
    const rows = reconcileBeliefs([aiStale, athleteStale], [], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('recovery')
    expect(rows[0].confidence).toBe('low') // ai decays medium → low
  })

  it('decays an athlete belief no lower than the medium floor', () => {
    const athleteHighStale = stored({ key: 'rpe_calibration', status: 'corrected', source: 'athlete', confidence: 'high', last_confirmed: '2026-04-01T00:00:00Z' })
    const [row] = reconcileBeliefs([athleteHighStale], [], NOW)
    expect(row.confidence).toBe('medium') // high → medium, floored (would not go to low)
  })

  it('does not decay a belief confirmed recently', () => {
    const fresh = stored({ key: 'recovery', confidence: 'high', last_confirmed: '2026-06-01T00:00:00Z' })
    expect(reconcileBeliefs([fresh], [], NOW)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/lib/athlete-model-reconcile.test.ts`
Expected: FAIL — `reconcileBeliefs is not a function`.

- [ ] **Step 3: Implement**

Create `lib/athlete-model/reconcile.ts`:

```ts
import type { AthleteBelief, BeliefConfidence } from '@/types'
import type { CandidateBelief } from './build-beliefs'

// A row to upsert (onConflict user_id,key). user_id is added by the orchestrator.
export type BeliefUpsert = Partial<AthleteBelief> & { key: string }

const RANK: Record<BeliefConfidence, number> = { low: 1, medium: 2, high: 3 }
const BY_RANK: BeliefConfidence[] = ['low', 'low', 'medium', 'high'] // index by rank (1..3)
const stepUp = (c: BeliefConfidence): BeliefConfidence => BY_RANK[Math.min(3, RANK[c] + 1)]
const stepDown = (c: BeliefConfidence, floor: BeliefConfidence): BeliefConfidence =>
  BY_RANK[Math.max(RANK[floor], RANK[c] - 1)]
const higher = (a: BeliefConfidence, b: BeliefConfidence): BeliefConfidence => (RANK[a] >= RANK[b] ? a : b)

const STALE_DAYS = 42 // ~6 weeks
function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 864e5
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// Whether stored and candidate value_data describe the same thing, within a per-key
// tolerance on the headline number. Missing data on either side → not agreeing.
function beliefsAgree(key: string, a: Record<string, unknown> | null, b: Record<string, unknown>): boolean {
  if (!a) return false
  if (key === 'ramp_tolerance') return Math.abs(num(a.pct) - num(b.pct)) <= 3
  if (key === 'rpe_calibration') return Math.abs(num(a.overall) - num(b.overall)) <= 0.5
  if (key === 'recovery') return Math.abs(num(a.nextDayCompletionRate) - num(b.nextDayCompletionRate)) <= 15
  return JSON.stringify(a) === JSON.stringify(b)
}

export function reconcileBeliefs(
  existing: AthleteBelief[],
  candidates: CandidateBelief[],
  now: string,
): BeliefUpsert[] {
  const byKey = new Map(existing.map(b => [b.key, b]))
  const candidateKeys = new Set(candidates.map(c => c.key))
  const out: BeliefUpsert[] = []

  for (const cand of candidates) {
    const ex = byKey.get(cand.key)

    if (!ex) {
      out.push({
        key: cand.key, label: cand.label, value_text: cand.value_text, value_data: cand.value_data,
        confidence: cand.confidence, evidence: cand.evidence, source: cand.source, status: 'active',
        first_observed: now, last_updated: now, last_confirmed: now, revisions: [], contradiction: null,
      })
      continue
    }

    if (ex.status === 'dismissed') continue // athlete vetoed — never resurrect from synthesis

    if (ex.status === 'confirmed' || ex.status === 'corrected') {
      // Athlete ground truth — never overwrite the value.
      if (beliefsAgree(cand.key, ex.value_data, cand.value_data)) {
        out.push({ ...ex, last_confirmed: now, last_updated: now, contradiction: null })
      } else {
        out.push({ ...ex, last_updated: now, contradiction: { observed: cand.value_text, noted_at: now } })
      }
      continue
    }

    // Active AI/computed belief.
    if (beliefsAgree(cand.key, ex.value_data, cand.value_data)) {
      out.push({
        ...ex, value_text: cand.value_text, value_data: cand.value_data, evidence: cand.evidence,
        confidence: higher(stepUp(ex.confidence), cand.confidence), last_updated: now, last_confirmed: now,
      })
    } else {
      out.push({
        ...ex, value_text: cand.value_text, value_data: cand.value_data, evidence: cand.evidence,
        confidence: cand.confidence, last_updated: now, last_confirmed: now,
        revisions: [
          ...ex.revisions,
          { value_text: ex.value_text, confidence: ex.confidence, evidence: ex.evidence, revised_at: now, reason: 'new evidence contradicted the prior value' },
        ],
      })
    }
  }

  // Decay stale beliefs that got no fresh candidate this run.
  for (const ex of existing) {
    if (candidateKeys.has(ex.key)) continue
    if (ex.status === 'dismissed' || ex.status === 'superseded') continue
    const last = ex.last_confirmed ?? ex.first_observed
    if (daysBetween(last, now) <= STALE_DAYS) continue
    const isAthlete = ex.status === 'confirmed' || ex.status === 'corrected'
    const decayed = stepDown(ex.confidence, isAthlete ? 'medium' : 'low')
    if (decayed === ex.confidence) continue // already at floor
    out.push({ ...ex, confidence: decayed, last_updated: now })
  }

  return out
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/lib/athlete-model-reconcile.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/athlete-model/reconcile.ts __tests__/lib/athlete-model-reconcile.test.ts
git commit -m "feat: reconcile candidate beliefs against stored state (accumulation)"
```

---

## Task 6: Orchestrator — `synthesizeBeliefs`

**Files:**
- Create: `lib/claude/synthesize-beliefs.ts`
- Create: `__tests__/lib/synthesize-beliefs.test.ts`

Fetch the last 120 days of workouts and feedback, assemble the inputs, build candidates, reconcile against stored beliefs, and upsert. Mirrors `lib/claude/synthesize-dossier.ts`. `now` is passed in so the test is deterministic.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/synthesize-beliefs.test.ts`:

```ts
import { synthesizeBeliefs } from '@/lib/claude/synthesize-beliefs'

// Minimal Supabase fake: records upserts and returns canned rows per table.
function fakeSupabase(opts: {
  workouts: unknown[]; feedback: unknown[]; beliefs: unknown[]
  onUpsert: (rows: unknown[]) => void
}) {
  return {
    from(table: string) {
      if (table === 'athlete_beliefs') {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: opts.beliefs }) }),
          upsert: (rows: unknown[]) => { opts.onUpsert(rows); return Promise.resolve({ error: null }) },
        }
      }
      const data = table === 'workouts' ? opts.workouts : opts.feedback
      // chainable select().eq().gte().order() resolving to { data }
      const qb: Record<string, unknown> = {}
      ;['select', 'eq', 'gte', 'order'].forEach(m => { qb[m] = () => qb })
      ;(qb as { then: unknown }).then = (res: (v: { data: unknown[] }) => unknown) => res({ data })
      return qb
    },
  } as unknown as Parameters<typeof synthesizeBeliefs>[0]
}

const NOW = '2026-06-05T03:00:00Z'

it('assembles, builds, reconciles and upserts a new ramp-tolerance belief', async () => {
  let upserted: unknown[] = []
  const workouts = [
    { id: 'w1', date: '2026-05-04', type: 'endurance', tss: 300, status: 'completed' },
    { id: 'w2', date: '2026-05-11', type: 'endurance', tss: 330, status: 'completed' },
    { id: 'w3', date: '2026-05-18', type: 'endurance', tss: 363, status: 'completed' },
    { id: 'w4', date: '2026-05-25', type: 'endurance', tss: 399, status: 'completed' },
  ]
  const supabase = fakeSupabase({ workouts, feedback: [], beliefs: [], onUpsert: r => { upserted = r } })

  await synthesizeBeliefs(supabase, 'u1', NOW)

  const keys = upserted.map(r => (r as { key: string }).key)
  expect(keys).toContain('ramp_tolerance')
  expect(upserted.every(r => (r as { user_id: string }).user_id === 'u1')).toBe(true)
})

it('writes nothing when there is not enough data for any belief', async () => {
  let upserted: unknown[] | null = null
  const supabase = fakeSupabase({ workouts: [], feedback: [], beliefs: [], onUpsert: r => { upserted = r } })
  await synthesizeBeliefs(supabase, 'u1', NOW)
  expect(upserted).toBeNull() // upsert never called
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/lib/synthesize-beliefs.test.ts`
Expected: FAIL — `synthesizeBeliefs is not a function`.

- [ ] **Step 3: Implement**

Create `lib/claude/synthesize-beliefs.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AthleteBelief, WorkoutType, FeedbackCompletion } from '@/types'
import { weeklyTssSeries, rpeSessionsFromFeedback, recoverySessions } from '@/lib/athlete-model/assemble'
import { buildGroundedBeliefs } from '@/lib/athlete-model/build-beliefs'
import { reconcileBeliefs } from '@/lib/athlete-model/reconcile'

type WorkoutRow = { id: string; date: string; type: WorkoutType; tss: number | null; status: string }
type FeedbackRow = { workout_id: string | null; rpe: number | null; feel: number | null; completion: FeedbackCompletion | null }

// Build/refresh the athlete's grounded beliefs from the last 120 days of training.
// `now` is injected for deterministic timestamps. Pure pipeline + a single upsert.
export async function synthesizeBeliefs(
  supabase: SupabaseClient,
  userId: string,
  now: string,
): Promise<void> {
  const since = new Date(new Date(now).getTime() - 120 * 864e5).toISOString().slice(0, 10)

  const [{ data: workoutData }, { data: feedbackData }, { data: beliefData }] = await Promise.all([
    supabase.from('workouts').select('id, date, type, tss, status')
      .eq('user_id', userId).gte('date', since).order('date'),
    supabase.from('session_feedback').select('workout_id, rpe, feel, completion')
      .eq('user_id', userId).gte('created_at', since),
    supabase.from('athlete_beliefs').select('*').eq('user_id', userId),
  ])

  const workouts = (workoutData ?? []) as WorkoutRow[]
  const feedback = (feedbackData ?? []) as FeedbackRow[]
  const existing = (beliefData ?? []) as AthleteBelief[]

  const workoutById = new Map(workouts.map(w => [w.id, w]))
  const fbByWorkout = new Map(feedback.filter(f => f.workout_id).map(f => [f.workout_id as string, f]))

  const candidates = buildGroundedBeliefs({
    weeklyTss: weeklyTssSeries(workouts.map(w => ({ date: w.date, tss: w.tss }))),
    rpeSessions: rpeSessionsFromFeedback(
      feedback.map(f => ({ rpe: f.rpe, type: (f.workout_id ? workoutById.get(f.workout_id)?.type : null) ?? null })),
    ),
    recovery: recoverySessions(
      workouts.map(w => {
        const f = fbByWorkout.get(w.id)
        return { date: w.date, type: w.type, status: w.status, completion: f?.completion ?? null, feel: f?.feel ?? null }
      }),
    ),
  })

  const upserts = reconcileBeliefs(existing, candidates, now)
  if (!upserts.length) return

  const { error } = await supabase
    .from('athlete_beliefs')
    .upsert(upserts.map(r => ({ ...r, user_id: userId })), { onConflict: 'user_id,key' })
  if (error) throw new Error(`synthesizeBeliefs upsert failed: ${error.message}`)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/lib/synthesize-beliefs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/claude/synthesize-beliefs.ts __tests__/lib/synthesize-beliefs.test.ts
git commit -m "feat: synthesizeBeliefs orchestrator (assemble→build→reconcile→upsert)"
```

---

## Task 7: Run it from the nightly cron

**Files:**
- Modify: `app/api/cron/dossier/route.ts`

The dossier cron already loops eligible profiles at 3am local and calls `synthesizeDossier`. Call `synthesizeBeliefs` for the same user in the same try block, best-effort: a belief-synthesis failure must not abort the dossier run.

- [ ] **Step 1: Add the call**

In `app/api/cron/dossier/route.ts`, add the import near the existing `synthesizeDossier` import:

```ts
import { synthesizeBeliefs } from '@/lib/claude/synthesize-beliefs'
```

Inside the per-profile `try { ... }` block, immediately after the `await synthesizeDossier({ ... })` call, add:

```ts
      try {
        await synthesizeBeliefs(supabase, profile.user_id, runAt.toISOString())
      } catch (beliefErr) {
        // Best-effort: a belief-synthesis failure must not abort the dossier run.
        console.error(`[cron/dossier] beliefs failed for user ${profile.user_id}:`, beliefErr)
        await log(profile.user_id, 'beliefs_failed', 'error', { error: String(beliefErr) })
      }
```

(`runAt` and `log` are already defined in that handler. `supabase` is the service-role client already in scope.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Full suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/dossier/route.ts
git commit -m "feat: run belief synthesis from the nightly dossier cron"
```

---

## Done criteria

- Assembly, build, reconcile modules implemented and unit-tested (pure).
- `synthesizeBeliefs` orchestrator implemented and tested with a Supabase fake.
- The nightly cron runs belief synthesis best-effort alongside the dossier.
- `npm run typecheck` clean; full `npx jest` green.
- After deploy + the migration from Plan 1, the model populates and accumulates each night.

## Self-review notes (addressed)

- **Spec coverage:** assembly + grounding (Plan 1) + build = the grounded belief set; reconcile = accumulation/sticky/contradiction/decay (spec §3); cron hook = "runs inside the existing dossier synthesis cron". Soft AI beliefs (affinities, FTP-movers) are explicitly deferred — noted in the architecture header.
- **Type consistency:** `CandidateBelief` defined in `build-beliefs.ts`, imported by `reconcile.ts` and the orchestrator. `BeliefUpsert = Partial<AthleteBelief> & { key: string }`. Keys `ramp_tolerance` / `rpe_calibration` / `recovery` are used identically in build, reconcile tolerances, and tests.
- **Determinism:** `now` is injected into every pure function and the orchestrator; no `Date.now()` in pure code.

## What comes next (Plan 3)

`GET/PATCH /api/athlete-model`, the `AthleteModel` coach-page section (confirm/correct/dismiss → flips `status` to confirmed/corrected/dismissed, `source` to athlete), and wiring `formatAthleteModel` into `lib/claude/plan.ts` and `lib/claude/briefing.ts`.
