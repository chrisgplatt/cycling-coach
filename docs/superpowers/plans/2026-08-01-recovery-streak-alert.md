# Recovery Streak Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Recovery Score is Red (`band === 'low'`, score <50) for 2 days in a row, the day's coach note opens with an explicit "ease off" recommendation instead of treating it as routine.

**Architecture:** A pure helper (`getConsecutiveRedDays`) added to `lib/recovery-score.ts` inspects the last two entries of the recovery-inputs history the briefing route already fetches. The result flows into `BriefingContext` as `recoveryStreakDays`, which the Claude prompt builder in `lib/claude/briefing.ts` turns into one extra context line, backed by a new coaching rule in `cycling-coach/CLAUDE.md`. No new endpoints, tables, cron jobs, or UI.

**Tech Stack:** Next.js App Router, TypeScript, Jest (existing `lib/recovery-score.ts` and `lib/claude/briefing.ts` test suites).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-01-recovery-streak-alert-design.md`
- Trigger is exactly 2 consecutive `band === 'low'` days — not a broader Amber-or-Red window, not a per-metric trend (per spec's scope decision)
- No new push notification, cron, endpoint, or UI — folded entirely into the existing daily coach note (per spec's scope decision)
- `lib/recovery-score.ts` must remain a pure module with no side effects (existing repo convention, restated in the spec)
- Run `npm run typecheck` before committing any task that touches `.ts`/`.tsx` files — Jest does not surface TypeScript errors (per `AGENTS.md`)

---

### Task 1: `getConsecutiveRedDays` helper in `lib/recovery-score.ts`

**Files:**
- Modify: `lib/recovery-score.ts` (add import + new exported function at end of file)
- Test: `__tests__/lib/recovery-score.test.ts` (add new `describe` block)

**Interfaces:**
- Consumes: `RecoveryInputsRangeResult` (`{ date: string; inputs: RecoveryInputs }`), already exported from `lib/recovery-inputs.ts`; `computeRecoveryScore` (already in this file)
- Produces: `export function getConsecutiveRedDays(results: RecoveryInputsRangeResult[]): number` — returns `2` when the last two entries both score `band === 'low'`, else `0`. Later tasks call this as `getConsecutiveRedDays(recoveryInputsResult)`.

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to the end of `__tests__/lib/recovery-score.test.ts` (after the existing `describe('computeWellnessIndex', ...)` block, i.e. after line 142):

```typescript
describe('getConsecutiveRedDays', () => {
  const RED: RecoveryInputs = {
    hrv: 30, hrvBaseline: 50, // ratio 0.60 → hrv index 0
    garmin_sleep_deep_secs: 0, garmin_sleep_light_secs: 3600, garmin_sleep_rem_secs: 0, garmin_sleep_awake_secs: 0,
    body_battery_high: 20,
    energy: 1, leg_freshness: 1,
    tsb: -25,
  }
  const GREEN: RecoveryInputs = {
    hrv: 55, hrvBaseline: 50,
    garmin_sleep_deep_secs: 5760, garmin_sleep_light_secs: 14400, garmin_sleep_rem_secs: 7200, garmin_sleep_awake_secs: 1440,
    body_battery_high: 80,
    energy: 4, leg_freshness: 4,
    tsb: 10,
  }
  const EMPTY: RecoveryInputs = {
    hrv: null, hrvBaseline: null,
    garmin_sleep_deep_secs: null, garmin_sleep_light_secs: null, garmin_sleep_rem_secs: null, garmin_sleep_awake_secs: null,
    body_battery_high: null, energy: null, leg_freshness: null, tsb: null,
  }

  function point(date: string, inputs: RecoveryInputs): RecoveryInputsRangeResult {
    return { date, inputs }
  }

  it('returns 2 when the last two days are both Red', () => {
    expect(getConsecutiveRedDays([point('2026-07-30', RED), point('2026-07-31', RED)])).toBe(2)
  })

  it('returns 0 when the most recent day is not Red', () => {
    expect(getConsecutiveRedDays([point('2026-07-30', RED), point('2026-07-31', GREEN)])).toBe(0)
  })

  it('returns 0 when only the second-to-last day is Red', () => {
    expect(getConsecutiveRedDays([point('2026-07-30', GREEN), point('2026-07-31', RED)])).toBe(0)
  })

  it('returns 0 when a data gap (fully unavailable day) sits between two Red days', () => {
    // EMPTY defaults to score 50 / band 'moderate', not 'low' — it breaks the streak.
    expect(getConsecutiveRedDays([point('2026-07-29', RED), point('2026-07-30', EMPTY), point('2026-07-31', RED)])).toBe(0)
  })

  it('returns 0 when only one day of history is available', () => {
    expect(getConsecutiveRedDays([point('2026-07-31', RED)])).toBe(0)
  })

  it('returns 0 for an empty array', () => {
    expect(getConsecutiveRedDays([])).toBe(0)
  })
})
```

Also add `getConsecutiveRedDays` and `RecoveryInputsRangeResult` to the file's imports — replace line 1:

```typescript
import { computeRecoveryScore, computeHrvIndex, computeWellnessIndex, getConsecutiveRedDays, type RecoveryInputs } from '@/lib/recovery-score'
import type { RecoveryInputsRangeResult } from '@/lib/recovery-inputs'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/recovery-score.test.ts -t "getConsecutiveRedDays"`
Expected: FAIL — `getConsecutiveRedDays is not a function` (or a TypeScript error that the import doesn't exist)

- [ ] **Step 3: Implement `getConsecutiveRedDays`**

Add this import at the top of `lib/recovery-score.ts` (as line 1, before the existing `export interface RecoveryInputs`):

```typescript
import type { RecoveryInputsRangeResult } from '@/lib/recovery-inputs'

```

Add this function at the end of `lib/recovery-score.ts` (after the existing `computeRecoveryScore` function, i.e. after line 115's closing `}`):

```typescript

/** Returns 2 when the most recent two entries both score band 'low' (Red), else 0.
 * A fully-unavailable day defaults to band 'moderate' (see computeRecoveryScore above),
 * so a data gap between two Red days correctly breaks the streak rather than being
 * skipped over. */
export function getConsecutiveRedDays(results: RecoveryInputsRangeResult[]): number {
  const last = results.at(-1)
  const prev = results.at(-2)
  if (!last || !prev) return 0
  const lastScore = computeRecoveryScore(last.inputs)
  const prevScore = computeRecoveryScore(prev.inputs)
  return lastScore.band === 'low' && prevScore.band === 'low' ? 2 : 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/recovery-score.test.ts`
Expected: PASS (all tests in the file, including the new `getConsecutiveRedDays` block)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms the type-only cross-import between `lib/recovery-score.ts` and `lib/recovery-inputs.ts` compiles cleanly)

- [ ] **Step 6: Commit**

```bash
git add lib/recovery-score.ts __tests__/lib/recovery-score.test.ts
git commit -m "Add getConsecutiveRedDays helper for the recovery streak alert"
```

---

### Task 2: `recoveryStreakDays` context field + prompt line + coaching rule

**Files:**
- Modify: `types/index.ts:721` (add field to `BriefingContext`)
- Modify: `lib/claude/briefing.ts:205-209` (add prompt line)
- Modify: `CLAUDE.md` (repo root — add coaching rule to the "Daily Wellness" section)
- Test: `__tests__/lib/claude-briefing.test.ts` (add new test)

**Interfaces:**
- Consumes: nothing new from Task 1 (this task only threads a plain `number | undefined` field through the prompt layer; it does not call `getConsecutiveRedDays` itself — Task 3 does)
- Produces: `BriefingContext.recoveryStreakDays?: number`, read by `generateBriefing` (`lib/claude/briefing.ts`) to append the new prompt line when `>= 2`. Task 3 sets this field from the route.

- [ ] **Step 1: Write the failing test**

Add this test to `__tests__/lib/claude-briefing.test.ts`, inside the existing `describe('buildTodayBriefingPrompt with recovery score', ...)` block (after the existing `it('passes recovery score line to the Claude prompt', ...)` test, i.e. after line 249's closing `})`):

```typescript

  it('adds the consecutive-Red-days line when recoveryStreakDays is 2', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text:
      '{"verdict":"red","headline":"Take a rest day","note":"Recovery has been low for two days."}' }] })
    const ctx: BriefingContext = {
      ...baseMorningCtx,
      recoveryScore: 38,
      recoveryBand: 'low',
      recoveryExplanation: 'HRV suppressed',
      recoveryStreakDays: 2,
    }
    await generateBriefing(ctx)
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('Recovery score has been Low (Red) for 2 consecutive days.')
  })

  it('omits the consecutive-Red-days line when recoveryStreakDays is absent', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text:
      '{"verdict":"amber","headline":"Take it easy","note":"Recovery is moderate today."}' }] })
    const ctx: BriefingContext = {
      ...baseMorningCtx,
      recoveryScore: 68,
      recoveryBand: 'moderate',
      recoveryExplanation: 'HRV suppressed',
    }
    await generateBriefing(ctx)
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(prompt).not.toContain('consecutive days')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/claude-briefing.test.ts -t "consecutive-Red-days"`
Expected: FAIL — first test fails because the prompt doesn't contain the new line yet (second test passes trivially since the line doesn't exist yet, but run both to confirm the harness works before implementing)

- [ ] **Step 3: Add the field to `BriefingContext`**

In `types/index.ts`, replace line 721:

```typescript
  recoveryExplanation?: string
```

with:

```typescript
  recoveryExplanation?: string
  recoveryStreakDays?: number
```

- [ ] **Step 4: Add the prompt line**

In `lib/claude/briefing.ts`, replace lines 205-209:

```typescript
  if (ctx.recoveryScore != null) {
    const bandLabel = ctx.recoveryBand ?? 'moderate'
    const expl = ctx.recoveryExplanation ? ` — ${ctx.recoveryExplanation}` : ''
    garminLines.push(`Recovery score: ${ctx.recoveryScore}/100 (${bandLabel})${expl}`)
  }
```

with:

```typescript
  if (ctx.recoveryScore != null) {
    const bandLabel = ctx.recoveryBand ?? 'moderate'
    const expl = ctx.recoveryExplanation ? ` — ${ctx.recoveryExplanation}` : ''
    garminLines.push(`Recovery score: ${ctx.recoveryScore}/100 (${bandLabel})${expl}`)
    if (ctx.recoveryStreakDays != null && ctx.recoveryStreakDays >= 2) {
      garminLines.push('Recovery score has been Low (Red) for 2 consecutive days.')
    }
  }
```

- [ ] **Step 5: Add the coaching rule to `CLAUDE.md`**

In `CLAUDE.md` (repo root), find this bullet in the "## Daily Wellness" section:

```
- **Consistently low readings (2+ consecutive days on any metric):** Flag as a pattern and recommend a recovery week or load reduction.
```

Add a new bullet immediately after it:

```
- **Consecutive low Recovery Score (2+ days, low/Red band):** Treat as a stronger signal than a single bad day. Open the note by recommending an easy day or rest — don't bury this lower down or treat it as routine.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/lib/claude-briefing.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add types/index.ts lib/claude/briefing.ts CLAUDE.md __tests__/lib/claude-briefing.test.ts
git commit -m "Add recoveryStreakDays prompt line and coaching rule"
```

---

### Task 3: Wire the route to compute and pass `recoveryStreakDays`

**Files:**
- Modify: `app/api/briefing/today/route.ts:10` (import), `:307-313` (compute streak), `:359-362` (add to context)

**Interfaces:**
- Consumes: `getConsecutiveRedDays` (Task 1, `lib/recovery-score.ts`), `recoveryStreakDays` field (Task 2, `types/index.ts`)
- Produces: nothing further downstream — this is the final wiring task

There is no existing test file for `app/api/briefing/today/route.ts` (it requires a live Supabase/intervals.icu integration harness this codebase doesn't have for this route) — verification here is `npm run typecheck` plus the two Jest suites from Tasks 1–2, which already cover the logic this task wires together.

- [ ] **Step 1: Update the import**

In `app/api/briefing/today/route.ts`, replace line 10:

```typescript
import { computeRecoveryScore } from '@/lib/recovery-score'
```

with:

```typescript
import { computeRecoveryScore, getConsecutiveRedDays } from '@/lib/recovery-score'
```

- [ ] **Step 2: Compute the streak alongside the existing recovery score**

Replace lines 307-313:

```typescript
  const recoveryResult = computeRecoveryScore(
    recoveryInputsResult.at(-1)?.inputs ?? {
      hrv: null, hrvBaseline: null, garmin_sleep_deep_secs: null, garmin_sleep_light_secs: null,
      garmin_sleep_rem_secs: null, garmin_sleep_awake_secs: null, body_battery_high: null,
      energy: null, leg_freshness: null, tsb: null,
    },
  )
```

with:

```typescript
  const recoveryResult = computeRecoveryScore(
    recoveryInputsResult.at(-1)?.inputs ?? {
      hrv: null, hrvBaseline: null, garmin_sleep_deep_secs: null, garmin_sleep_light_secs: null,
      garmin_sleep_rem_secs: null, garmin_sleep_awake_secs: null, body_battery_high: null,
      energy: null, leg_freshness: null, tsb: null,
    },
  )
  const recoveryStreakDays = getConsecutiveRedDays(recoveryInputsResult)
```

- [ ] **Step 3: Pass it into the `BriefingContext`**

Replace lines 359-361:

```typescript
    recoveryScore: recoveryResult.score,
    recoveryBand: recoveryResult.band,
    recoveryExplanation: recoveryResult.explanation,
```

with:

```typescript
    recoveryScore: recoveryResult.score,
    recoveryBand: recoveryResult.band,
    recoveryExplanation: recoveryResult.explanation,
    recoveryStreakDays,
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS (no regressions — this task only adds one computed value and one object field, both already covered by Tasks 1–2's unit tests)

- [ ] **Step 6: Commit**

```bash
git add app/api/briefing/today/route.ts
git commit -m "Wire recoveryStreakDays into the daily briefing route"
```
