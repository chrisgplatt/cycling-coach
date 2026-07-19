# Strain Coach Target Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Recovery-driven daily Strain target range (Whoop's "Strain Coach"), shown as tick marks on the dashboard's Strain ring and referenced in the AI coach's morning briefing.

**Architecture:** A new pure function `computeStrainTarget(recoveryScore)` in `lib/strain.ts` maps a 0–100 Recovery score to a `{low, high}` 0–21 Strain range. `MetricRing` gains optional tick-mark props (percentage scale, like its existing `pct` prop) purely for rendering; `StrainRingStrip` does the 0–21→0–100 conversion when calling it. The briefing route computes the same range from its own already-computed Recovery score and threads it through `BriefingContext` into the existing prompt-building logic.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Jest + Testing Library.

## Global Constraints

- Run `npm run typecheck` before every commit.
- Never use `git commit --amend`; always create new commits. Never use `--no-verify`.
- No new data fetching, no new database columns — this is pure derived computation from `recovery.score`, which both consumers (`app/dashboard/page.tsx`, `app/api/briefing/today/route.ts`) already compute.
- The target range is independent of the training plan and static per morning (computed once from that morning's Recovery score, not live-updated through the day) — do not add plan-awareness or live in/under/over-range tracking; both are explicitly out of scope per the design spec.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/strain.ts` | Add `computeStrainTarget` pure function + 2 tunable constants |
| `components/MetricRing.tsx` | Add optional `targetLowPct`/`targetHighPct` props, render tick marks |
| `components/StrainRingStrip.tsx` | Compute the target range, convert to percentages, pass to the Strain ring |
| `types/index.ts` | Add `strainTargetLow`/`strainTargetHigh` to `BriefingContext` |
| `app/api/briefing/today/route.ts` | Compute the target range from `recoveryResult.score`, set on `BriefingContext` |
| `lib/claude/briefing.ts` | Append the range to the Strain prompt line; add one coaching instruction to `SYSTEM_MORNING` |

---

### Task 1: `computeStrainTarget` in `lib/strain.ts`

**Files:**
- Modify: `lib/strain.ts` (insert after `computeWorkoutStrain`, currently ending at line 61)
- Test: `__tests__/lib/strain.test.ts`

**Interfaces:**
- Produces (consumed by Task 3 and Task 4):
  ```typescript
  export const STRAIN_TARGET_LOW_MAX = 14
  export const STRAIN_TARGET_RANGE_WIDTH = 7
  export function computeStrainTarget(recoveryScore: number): { low: number; high: number }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/strain.test.ts` (add `computeStrainTarget` to the existing top-of-file import list from `@/lib/strain`):

```typescript
describe('computeStrainTarget', () => {
  test('recovery 70 gives a range close to Whoop\'s disclosed 8.3-16.3 example', () => {
    // low = round(0.70 * 14) = round(9.8) = 10; high = min(21, 10+7) = 17
    expect(computeStrainTarget(70)).toEqual({ low: 10, high: 17 })
  })

  test('recovery 100 reaches the top of the scale', () => {
    // low = round(1.00 * 14) = 14; high = min(21, 14+7) = 21
    expect(computeStrainTarget(100)).toEqual({ low: 14, high: 21 })
  })

  test('recovery 34 (Whoop\'s red cutoff) stays light-to-moderate', () => {
    // low = round(0.34 * 14) = round(4.76) = 5; high = min(21, 5+7) = 12
    expect(computeStrainTarget(34)).toEqual({ low: 5, high: 12 })
  })

  test('recovery 0 gives the lowest possible range', () => {
    expect(computeStrainTarget(0)).toEqual({ low: 0, high: 7 })
  })

  test('high is capped at 21 even if low+width would exceed it', () => {
    // Not reachable with the current constants at recoveryScore<=100, but the
    // cap must still hold if STRAIN_TARGET_LOW_MAX/RANGE_WIDTH are ever retuned.
    const { high } = computeStrainTarget(100)
    expect(high).toBeLessThanOrEqual(21)
  })

  test('out-of-range recoveryScore is clamped rather than producing a negative or >14 low', () => {
    expect(computeStrainTarget(-10)).toEqual({ low: 0, high: 7 })
    expect(computeStrainTarget(150)).toEqual({ low: 14, high: 21 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- __tests__/lib/strain.test.ts`
Expected: FAIL — `computeStrainTarget` is not exported.

- [ ] **Step 3: Implement `computeStrainTarget`**

Insert immediately after `computeWorkoutStrain` (after line 61) in `lib/strain.ts`:

```typescript
export const STRAIN_TARGET_LOW_MAX = 14     // recovery=100 → low bound approaches 14
export const STRAIN_TARGET_RANGE_WIDTH = 7  // range width, tunable — matches Whoop's ~8pt example

export function computeStrainTarget(recoveryScore: number): { low: number; high: number } {
  const low = Math.round(clamp01(recoveryScore / 100) * STRAIN_TARGET_LOW_MAX)
  const high = Math.min(21, low + STRAIN_TARGET_RANGE_WIDTH)
  return { low, high }
}
```

`clamp01` already exists in this file (line 5) — reuse it, don't redefine it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- __tests__/lib/strain.test.ts`
Expected: PASS, `computeStrainTarget` describe block green.

- [ ] **Step 5: Commit**

```bash
git add lib/strain.ts __tests__/lib/strain.test.ts
git commit -m "feat: add computeStrainTarget — Whoop-style Recovery-driven Strain range"
```

---

### Task 2: Tick marks in `components/MetricRing.tsx`

**Files:**
- Modify: `components/MetricRing.tsx`
- Test: `__tests__/components/MetricRing.test.tsx`

**Interfaces:**
- Produces (consumed by Task 3): `MetricRing` accepts two new optional props, `targetLowPct?: number` and `targetHighPct?: number` (0–100 scale, same convention as the existing `pct` prop). When present, each renders a small tick mark on the ring's rim at that percentage position (0% = top, clockwise, matching the conic-gradient fill's own convention). Absent props render no ticks — fully backward compatible with the two existing callers (Recovery and Sleep rings in `StrainRingStrip`, which don't pass these props).

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/components/MetricRing.test.tsx`:

```typescript
test('renders tick marks when targetLowPct/targetHighPct are provided', () => {
  render(
    <MetricRing displayValue="13" pct={62} label="Strain" bandLabel="Moderate" color="#d97706"
      targetLowPct={47.6} targetHighPct={81}
    />
  )
  expect(screen.getByTestId('ring-tick-low')).toBeInTheDocument()
  expect(screen.getByTestId('ring-tick-high')).toBeInTheDocument()
})

test('renders no tick marks when targetLowPct/targetHighPct are not provided', () => {
  render(<MetricRing displayValue="13" pct={62} label="Strain" bandLabel="Moderate" color="#d97706" />)
  expect(screen.queryByTestId('ring-tick-low')).not.toBeInTheDocument()
  expect(screen.queryByTestId('ring-tick-high')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- __tests__/components/MetricRing.test.tsx`
Expected: FAIL — no elements with those test IDs exist yet.

- [ ] **Step 3: Implement the tick marks**

Replace the full contents of `components/MetricRing.tsx`:

```typescript
'use client'

interface MetricRingProps {
  displayValue: string
  pct: number       // 0-100, portion of the ring to fill
  label: string
  bandLabel: string
  color: string      // hex color for the filled arc and band label text
  onTap?: () => void
  targetLowPct?: number   // 0-100, optional tick mark position on the ring's rim
  targetHighPct?: number  // 0-100, optional tick mark position on the ring's rim
}

// A tick is rendered as a small dot at the top of a full-size wrapper div, then the
// whole wrapper is rotated around the ring's center — the classic CSS clock-hand
// technique. 0% = top (unrotated), rotating clockwise, matching the conic-gradient
// fill's own 0%-at-top convention so a tick at pct=X lines up with the fill at X%.
function RingTick({ pct, testId }: { pct: number; testId: string }) {
  const angle = (Math.max(0, Math.min(100, pct)) / 100) * 360
  return (
    <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }} data-testid={testId}>
      <div
        className="absolute rounded-full bg-gray-700"
        style={{ width: 3, height: 3, top: 1, left: '50%', marginLeft: -1.5 }}
      />
    </div>
  )
}

export default function MetricRing({
  displayValue, pct, label, bandLabel, color, onTap, targetLowPct, targetHighPct,
}: MetricRingProps) {
  const clamped = Math.max(0, Math.min(100, pct))
  const ring = (
    <>
      <div
        className="relative rounded-full flex items-center justify-center"
        style={{ width: 72, height: 72, background: `conic-gradient(${color} 0% ${clamped}%, #e5e7eb ${clamped}% 100%)` }}
      >
        {targetLowPct != null && <RingTick pct={targetLowPct} testId="ring-tick-low" />}
        {targetHighPct != null && <RingTick pct={targetHighPct} testId="ring-tick-high" />}
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

The only changes from the current file: `relative` added to the outer ring `div`'s className (so the absolutely-positioned ticks anchor to it, not the page), the two new optional props, and the `RingTick` helper. Everything else — the button/div branch, existing props, existing tests — is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- __tests__/components/MetricRing.test.tsx`
Expected: PASS, all 5 tests (3 existing + 2 new) green.

- [ ] **Step 5: Commit**

```bash
git add components/MetricRing.tsx __tests__/components/MetricRing.test.tsx
git commit -m "feat: add optional target-range tick marks to MetricRing"
```

---

### Task 3: Wire the target range into `components/StrainRingStrip.tsx`

**Files:**
- Modify: `components/StrainRingStrip.tsx`
- Test: `__tests__/components/StrainRingStrip.test.tsx`

**Interfaces:**
- Consumes: `computeStrainTarget` from `@/lib/strain` (Task 1); `targetLowPct`/`targetHighPct` props on `MetricRing` (Task 2).

- [ ] **Step 1: Write the failing test**

Append to `__tests__/components/StrainRingStrip.test.tsx` (reuse the file's existing `recovery`/`strainToday`/`wellness` fixtures — read the file first to match its exact fixture shapes and import style before writing this):

```typescript
test('passes a converted target range to the Strain ring as percentages', () => {
  // recovery.score=78 → computeStrainTarget(78) = { low: round(0.78*14)=11, high: 18 }
  // as percentages of 21: low 11/21*100≈52.38, high 18/21*100≈85.71
  render(
    <StrainRingStrip recovery={recovery} strainToday={strainToday} wellness={wellness} activities={[]} maxHr={190} restingHr={50} />
  )
  const strainRing = screen.getByRole('button', { name: /Strain breakdown/i }).closest('div') as HTMLElement
  // The two ticks render inside the Strain ring only — Recovery and Sleep rings get none.
  expect(screen.getAllByTestId('ring-tick-low')).toHaveLength(1)
  expect(screen.getAllByTestId('ring-tick-high')).toHaveLength(1)
})
```

(If the existing `recovery` fixture in this test file doesn't have `score: 78`, adjust the expected percentages in the comment/assertion to match whatever `recovery.score` the file's existing fixture actually uses — the point of this test is "exactly one tick pair renders, only on the Strain ring," not the specific numeric value, so don't over-fit the assertion to a score the fixture doesn't have.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- __tests__/components/StrainRingStrip.test.tsx`
Expected: FAIL — no tick test IDs render yet.

- [ ] **Step 3: Wire it in**

In `components/StrainRingStrip.tsx`:

Add to the import from `@/lib/strain` (currently `import { strainLabel } from '@/lib/strain'`):

```typescript
import { strainLabel, computeStrainTarget } from '@/lib/strain'
```

Inside the component body, after the existing `const sleepBandKey = ...` line, add:

```typescript
  const strainTarget = computeStrainTarget(recovery.score)
  const targetLowPct = (strainTarget.low / 21) * 100
  const targetHighPct = (strainTarget.high / 21) * 100
```

Update the Strain `MetricRing` instance to pass the two new props:

```jsx
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
```

The Recovery and Sleep `MetricRing` instances are unchanged — they don't receive `targetLowPct`/`targetHighPct`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- __tests__/components/StrainRingStrip.test.tsx`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Commit**

```bash
git add components/StrainRingStrip.tsx __tests__/components/StrainRingStrip.test.tsx
git commit -m "feat: show the Strain target range as tick marks on the dashboard ring"
```

---

### Task 4: `BriefingContext` field + all `BriefingContext`-constructing routes

**Files:**
- Modify: `types/index.ts` (insert near `dailyStrain`, currently at line 640 inside `BriefingContext`)
- Modify: `app/api/briefing/today/route.ts`
- Modify: `app/api/cron/daily-briefing/route.ts` (a second, simplified route that constructs its own `BriefingContext` — currently hardcodes `dailyStrain: null` at line 208, does not compute real strain/recovery data)
- Modify: `app/api/cron/test/route.ts` (same pattern, hardcodes `dailyStrain: null` at line 108)

**Interfaces:**
- Produces: `BriefingContext.strainTargetLow: number | null` and `BriefingContext.strainTargetHigh: number | null` — raw 0–21 strain points, not percentages (this type has no ring/percentage concept anywhere else). Consumed by Task 5.

There are exactly four files in the repo that construct a `BriefingContext` object literal — confirmed via `Grep -rln "BriefingContext = {"`: this route, the two cron routes below, and `__tests__/lib/claude-briefing.test.ts` (handled in Task 5, not here). Making the new fields non-optional means all four must be updated or typecheck fails; this task covers the three non-test ones.

- [ ] **Step 1: Add the fields to `BriefingContext`**

In `types/index.ts`, inside the `BriefingContext` interface, immediately after the existing `dailyStrain: number | null` line:

```typescript
  strainTargetLow: number | null
  strainTargetHigh: number | null
```

- [ ] **Step 2: Compute and set them in the briefing route**

In `app/api/briefing/today/route.ts`, add `computeStrainTarget` to the existing `lib/strain` import (currently `import { computeDailyTrimp, computeTrimpRef, computeWorkoutStrain, type DailyActivityInput } from '@/lib/strain'`):

```typescript
import { computeDailyTrimp, computeTrimpRef, computeWorkoutStrain, computeStrainTarget, type DailyActivityInput } from '@/lib/strain'
```

Immediately after the existing `const recoveryResult = computeRecoveryScore({...})` block (ends at line 313), add:

```typescript
  const strainTarget = computeStrainTarget(recoveryResult.score)
```

In the `ctx: BriefingContext = {...}` object literal, immediately after the existing `dailyStrain,` line (line 336), add:

```typescript
    strainTargetLow: strainTarget.low,
    strainTargetHigh: strainTarget.high,
```

- [ ] **Step 3: Update the two cron routes**

These routes don't compute real Recovery/Strain data (they already hardcode `dailyStrain: null`) — match that existing pattern rather than adding a real computation to routes that don't have one today.

In `app/api/cron/daily-briefing/route.ts`, change line 208 from `dailyStrain: null,` to:

```typescript
      dailyStrain: null,
      strainTargetLow: null,
      strainTargetHigh: null,
```

In `app/api/cron/test/route.ts`, change line 108 from `dailyStrain: null,` to:

```typescript
    dailyStrain: null,
    strainTargetLow: null,
    strainTargetHigh: null,
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors in `types/index.ts`, `app/api/briefing/today/route.ts`, `app/api/cron/daily-briefing/route.ts`, or `app/api/cron/test/route.ts`. The one remaining expected failure is `__tests__/lib/claude-briefing.test.ts` (the fourth and last `BriefingContext`-constructing file), fixed in Task 5's Step 1.

- [ ] **Step 5: Commit**

```bash
git add types/index.ts app/api/briefing/today/route.ts app/api/cron/daily-briefing/route.ts app/api/cron/test/route.ts
git commit -m "feat: compute the Strain target range in all BriefingContext-constructing routes"
```

---

### Task 5: `lib/claude/briefing.ts` — prompt line and coaching instruction

**Files:**
- Modify: `lib/claude/briefing.ts`
- Test: `__tests__/lib/claude-briefing.test.ts`

**Interfaces:**
- Consumes: `BriefingContext.strainTargetLow`/`strainTargetHigh` (Task 4).

- [ ] **Step 1: Fix every `BriefingContext` fixture broken by Task 4's new required fields**

Run: `npm run typecheck` (if not already run this session) and note every file it flags for missing `strainTargetLow`/`strainTargetHigh` — expected to be `__tests__/lib/claude-briefing.test.ts`'s `basePostRideCtx`/`baseMorningCtx` fixtures (lines ~21–61) and any other `BriefingContext` object literal in the test suite `Grep -rl "BriefingContext" __tests__/` finds. For each, add:

```typescript
  strainTargetLow: null,
  strainTargetHigh: null,
```

immediately after that fixture's existing `dailyStrain: null,` line, so untouched tests keep behaving exactly as before (no target range in the prompt when these are null — see Step 3's implementation, which must treat null as "omit the line").

- [ ] **Step 2: Write the failing tests**

Append to `__tests__/lib/claude-briefing.test.ts`, inside (or as a new) describe block near the existing recovery-score prompt tests:

```typescript
describe('buildLoadString with Strain target range', () => {
  it('appends the target range to the Strain line when both bounds are present', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'GREEN: All good.' }] })
    await generateBriefing({ ...baseMorningCtx, dailyStrain: 13, strainTargetLow: 10, strainTargetHigh: 17 })
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('Daily Strain: 13/21 (moderate) — target 10-17')
  })

  it('omits the target range when strainTargetLow/High are null', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'GREEN: All good.' }] })
    await generateBriefing({ ...baseMorningCtx, dailyStrain: 13, strainTargetLow: null, strainTargetHigh: null })
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('Daily Strain: 13/21 (moderate)')
    expect(prompt).not.toContain('target')
  })

  it('omits the target range when dailyStrain itself is null, even if bounds are present', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'GREEN: All good.' }] })
    await generateBriefing({ ...baseMorningCtx, dailyStrain: null, strainTargetLow: 10, strainTargetHigh: 17 })
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(prompt).not.toContain('Daily Strain')
    expect(prompt).not.toContain('target')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- __tests__/lib/claude-briefing.test.ts`
Expected: FAIL — the new tests fail (no target text in the prompt yet); confirm no other test in the file regressed due to Step 1's fixture additions.

- [ ] **Step 4: Implement**

In `lib/claude/briefing.ts`, replace the `strainLine` computation inside `buildLoadString` (currently lines 45–47):

```typescript
  const strainLine = ctx.dailyStrain != null
    ? formatStrainForPrompt(ctx.dailyStrain) + (
        ctx.strainTargetLow != null && ctx.strainTargetHigh != null
          ? ` — target ${ctx.strainTargetLow}-${ctx.strainTargetHigh}`
          : ''
      )
    : null
```

Add one sentence to `SYSTEM_MORNING` (the long single-string constant at line 38), inserted right after the existing sentence "Strain < 9 combined with positive form (TSB > 0) supports a green verdict even for hard sessions." and before "When training phase is provided...":

```
" When a Strain target range is provided in the load string (e.g. 'target 10-17'), treat it as advisory guidance from the athlete's Recovery, not a rule that overrides the plan or the strain-verdict thresholds above: if today's strain is well under the target range and the plan calls for intensity, that supports going for it; if strain is already at or above the high end of the range, suggest easing off for the rest of the day. Only mention the target range when it adds something the strain-verdict rules above haven't already covered."
```

(This is prose to splice into the existing `SYSTEM_MORNING` string — match the existing string's style exactly: one continuous sentence-based paragraph, no line breaks, no markdown, consistent tone with its neighbors.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- __tests__/lib/claude-briefing.test.ts`
Expected: PASS, all tests including the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add lib/claude/briefing.ts __tests__/lib/claude-briefing.test.ts
git commit -m "feat: reference the Strain target range in the morning briefing prompt"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full CI check**

Run: `npm run test:ci`
Expected: All tests pass, zero typecheck errors anywhere in the repo.

- [ ] **Step 2: Grep for any other `BriefingContext` construction sites missed by Task 5**

Run: `Grep -rn "strainTargetLow\|strainTargetHigh" --glob '*.ts' --glob '*.tsx'`
Expected: Appears in `types/index.ts`, `app/api/briefing/today/route.ts`, `lib/claude/briefing.ts`, and every `__tests__/**/*.ts(x)` file that constructs a `BriefingContext` literal — confirm there isn't a `BriefingContext`-constructing file this plan missed (e.g. a fixture factory under `__tests__/support/`) that still fails typecheck.

- [ ] **Step 3: Manually verify in the running app**

Start the dev server (`npm run dev`) if not already running, load the dashboard, and confirm: the Strain ring shows two small tick marks on its rim in addition to the existing colored fill arc; the marks' positions look plausible relative to the current Strain value (e.g. if today's Strain sits between the two ticks, the fill arc's edge should visually fall between them). Trigger a briefing refresh and confirm the coach note doesn't error (the target-range instruction is additive text in an existing working prompt, low risk, but worth a live check since `SYSTEM_MORNING` is a shared, heavily-relied-on string).

- [ ] **Step 4: Report completion to the user**

Summarize what changed and confirm the Strain Coach target range is live end-to-end (ring + briefing).

---

## Self-Review Notes

- **Spec coverage:** Formula section → Task 1. Visual design (tick marks) → Task 2. "Only StrainRingStrip's Strain ring passes targetLowPct/targetHighPct" → Task 3. Briefing integration (prompt line + coaching instruction) → Task 5. "Where it's computed" (dashboard already has recovery in scope via StrainRingStrip's existing prop; briefing route computes its own) → Tasks 3 and 4. Files-to-change table → covered by Tasks 1–5.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code. The one spot with a caveat (Task 3 Step 1's note about adjusting the test to the fixture's actual `recovery.score`) is a legitimate "verify against real code" instruction consistent with how the two prior plans in this project handled brief-vs-reality gaps — not a placeholder, an explicit instruction to check before writing the assertion.
- **Type consistency:** `computeStrainTarget`'s `{ low, high }` return (0–21 scale) is never confused with `MetricRing`'s `targetLowPct`/`targetHighPct` (0–100 scale) — Task 3 is the one and only place the conversion happens, and the design spec's naming (`Pct` suffix) makes the distinction visible at every call site.
- **Fixed during self-review:** the original draft of Task 4 only updated `app/api/briefing/today/route.ts`, but `Grep -rln "BriefingContext = {"` found two more production files (`app/api/cron/daily-briefing/route.ts`, `app/api/cron/test/route.ts`) that construct their own `BriefingContext` and would have failed typecheck once the new fields became required. Task 4 now covers all three non-test construction sites explicitly.
