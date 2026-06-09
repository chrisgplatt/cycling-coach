# Daily Strain Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive a 0–21 daily strain score from Garmin wellness data already synced to intervals.icu, display it as a chip on MetricsBar, feed it into all Claude prompts, and use it in readiness verdict + plan adaptation logic.

**Architecture:** Expand the `ICUWellness` type and `getWellness()` mapping to pull six new Garmin fields (body battery, stress, training load, sleep score). A pure helper `lib/strain.ts` computes the 0–21 score. `BriefingContext` carries `dailyStrain` and `strainHistory` so the briefing route, `buildLoadString`, the readiness verdict, and the MetricsBar chip all share one computation path.

**Tech Stack:** TypeScript, Next.js App Router, Jest (test runner), intervals.icu REST API (already integrated via `IntervalsClient`)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `types/index.ts` | Modify | Add 6 fields to `ICUWellness`; add `dailyStrain` + `strainHistory` to `BriefingContext` |
| `lib/intervals/client.ts` | Modify | Map new fields in `getWellness()` |
| `lib/strain.ts` | Create | `computeDailyStrain`, `strainLabel`, `formatStrainForPrompt` |
| `__tests__/lib/strain.test.ts` | Create | Unit tests for all strain helpers |
| `components/MetricsBar.tsx` | Modify | Add Strain chip |
| `app/api/briefing/today/route.ts` | Modify | Compute `dailyStrain` + `strainHistory` from wellness array; add to context |
| `lib/claude/briefing.ts` | Modify | Extend `buildLoadString`; update readiness verdict with strain thresholds |

---

## Task 1: Expand ICUWellness type

**Files:**
- Modify: `types/index.ts:259–267`

- [ ] **Step 1: Replace the ICUWellness interface**

Open `types/index.ts`. Find the `ICUWellness` interface at line 259 and replace it:

```typescript
export interface ICUWellness {
  id: string    // YYYY-MM-DD
  ctl: number | null
  atl: number | null
  form: number | null
  hrv: number | null
  resting_hr: number | null
  sleep_secs: number | null
  // Garmin fields (populated when Garmin is connected to intervals.icu)
  body_battery_low: number | null
  body_battery_high: number | null
  stress_avg: number | null
  stress_high: number | null
  garmin_training_load: number | null
  sleep_score: number | null
}
```

- [ ] **Step 2: Add strain fields to BriefingContext**

In the same file, find `BriefingContext` (line 438). Add two fields after `hrvStatus`:

```typescript
  dailyStrain: number | null
  strainHistory?: Array<{ date: string; strain: number | null }>
```

The full addition sits between `hrvStatus` and `recentWorkouts` lines:

```typescript
  hrv: number | null
  hrvStatus?: import('@/lib/hrv/baseline').HrvStatus | null
  dailyStrain: number | null
  strainHistory?: Array<{ date: string; strain: number | null }>
  recentWorkouts: Array<{
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors (the new fields are optional or nullable — existing call sites pass `null` for `dailyStrain`).

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "types: add Garmin wellness fields to ICUWellness and strain fields to BriefingContext"
```

---

## Task 2: Expand getWellness() mapping

**Files:**
- Modify: `lib/intervals/client.ts:310–323`

**Context:** The intervals.icu wellness API returns camelCase field names. The existing mapping already uses dual-key fallbacks (e.g. `w.restingHR ?? w.resting_hr`). The Garmin fields follow the same pattern. The exact names are `bodyBatteryLow`, `bodyBatteryHigh`, `avgStress`, `maxStress`, `trainingLoad`, and `sleepScore` — but **verify these against a real API response** in Step 2 below.

- [ ] **Step 1: Expand the mapping in `getWellness()`**

Replace the existing `getWellness` method body (lines 310–323) with:

```typescript
async getWellness(start: string, end: string): Promise<ICUWellness[]> {
  const raw = await this.request<Array<Record<string, unknown>>>(
    `/athlete/${this.athleteId}/wellness?start=${start}&end=${end}`
  )
  return raw.map(w => ({
    id: w.id as string,
    ctl: (w.ctl ?? null) as number | null,
    atl: (w.atl ?? null) as number | null,
    form: (w.form ?? null) as number | null,
    hrv: (w.hrv ?? null) as number | null,
    resting_hr: ((w.restingHR ?? w.resting_hr) ?? null) as number | null,
    sleep_secs: ((w.sleepSecs ?? w.sleep_secs) ?? null) as number | null,
    body_battery_low: ((w.bodyBatteryLow ?? w.body_battery_low) ?? null) as number | null,
    body_battery_high: ((w.bodyBatteryHigh ?? w.body_battery_high) ?? null) as number | null,
    stress_avg: ((w.avgStress ?? w.avg_stress ?? w.stressAvg) ?? null) as number | null,
    stress_high: ((w.maxStress ?? w.max_stress ?? w.stressHigh) ?? null) as number | null,
    garmin_training_load: ((w.trainingLoad ?? w.training_load) ?? null) as number | null,
    sleep_score: ((w.sleepScore ?? w.sleep_score) ?? null) as number | null,
  }))
}
```

- [ ] **Step 2: Verify API field names in dev**

Add a temporary `console.log` immediately after `const raw = await this.request(...)`:

```typescript
if (raw.length) console.log('[getWellness] sample fields:', Object.keys(raw[0]))
```

Start the dev server (`npm run dev`), open the dashboard, and check the terminal output to confirm which field names the API actually uses. Update the mapping keys above if they differ, then **remove the log line**.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/intervals/client.ts
git commit -m "feat: expand getWellness to map Garmin body battery, stress, training load, sleep score"
```

---

## Task 3: Create lib/strain.ts

**Files:**
- Create: `lib/strain.ts`
- Create: `__tests__/lib/strain.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `__tests__/lib/strain.test.ts`:

```typescript
/** @jest-environment node */
import { computeDailyStrain, strainLabel, formatStrainForPrompt } from '@/lib/strain'

describe('computeDailyStrain', () => {
  test('typical hard training day', () => {
    // trainingLoad=220, stressAvg=54
    // workout = (220/400)*14 = 7.7, life = (54/100)*7 = 3.78 → round(11.48) = 11
    expect(computeDailyStrain(220, 54)).toBe(11)
  })

  test('rest day with moderate stress', () => {
    // trainingLoad=0, stressAvg=80
    // workout = 0, life = (80/100)*7 = 5.6 → round(5.6) = 6
    expect(computeDailyStrain(0, 80)).toBe(6)
  })

  test('very high training load caps at 21', () => {
    expect(computeDailyStrain(600, 100)).toBe(21)
  })

  test('zero everything → 0', () => {
    expect(computeDailyStrain(0, 0)).toBe(0)
  })

  test('null trainingLoad falls back to stress only', () => {
    // workout = 0, life = (50/100)*7 = 3.5 → round(3.5) = 4 (JS rounds .5 up)
    expect(computeDailyStrain(null, 50)).toBe(4)
  })

  test('null stressAvg falls back to training only', () => {
    // workout = (200/400)*14 = 7, life = 0 → 7
    expect(computeDailyStrain(200, null)).toBe(7)
  })

  test('both null → null', () => {
    expect(computeDailyStrain(null, null)).toBeNull()
  })
})

describe('strainLabel', () => {
  test('below 9 → low', () => expect(strainLabel(8)).toBe('low'))
  test('9 → moderate', () => expect(strainLabel(9)).toBe('moderate'))
  test('14 → moderate', () => expect(strainLabel(14)).toBe('moderate'))
  test('15 → high', () => expect(strainLabel(15)).toBe('high'))
  test('21 → high', () => expect(strainLabel(21)).toBe('high'))
})

describe('formatStrainForPrompt', () => {
  test('includes score and label', () => {
    const s = formatStrainForPrompt(11)
    expect(s).toContain('11')
    expect(s).toContain('21')
    expect(s).toContain('moderate')
  })

  test('null → empty string', () => {
    expect(formatStrainForPrompt(null)).toBe('')
  })
})

describe('formatStrainHistoryForPrompt', () => {
  test('7-day history includes avg and trend', () => {
    const history = [8, 14, 16, 12, 9, 6, 11].map((strain, i) => ({
      date: `2026-06-0${i + 1}`,
      strain,
    }))
    const s = formatStrainHistoryForPrompt(history)
    expect(s).toContain('last 7 days')
    expect(s).toContain('avg:')
    expect(s).toMatch(/trend: (rising|stable|falling)/)
  })

  test('all-null history → empty string', () => {
    const history = [null, null, null].map((strain, i) => ({ date: `2026-06-0${i + 1}`, strain }))
    expect(formatStrainHistoryForPrompt(history)).toBe('')
  })

  test('single entry → empty string', () => {
    expect(formatStrainHistoryForPrompt([{ date: '2026-06-01', strain: 10 }])).toBe('')
  })

  test('rising trend detected when recent > earlier + 2', () => {
    const history = [4, 5, 4, 5, 14, 15, 16].map((strain, i) => ({
      date: `2026-06-0${i + 1}`,
      strain,
    }))
    expect(formatStrainHistoryForPrompt(history)).toContain('rising')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest __tests__/lib/strain.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '@/lib/strain'"

- [ ] **Step 3: Implement lib/strain.ts**

Create `lib/strain.ts`:

```typescript
export const STRAIN_TRAINING_LOAD_MAX = 400
export const STRAIN_WORKOUT_WEIGHT = 14
export const STRAIN_LIFE_WEIGHT = 7

export function computeDailyStrain(
  garminTrainingLoad: number | null,
  stressAvg: number | null,
): number | null {
  if (garminTrainingLoad == null && stressAvg == null) return null
  const workout = ((garminTrainingLoad ?? 0) / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT
  const life = ((stressAvg ?? 0) / 100) * STRAIN_LIFE_WEIGHT
  return Math.min(21, Math.round(workout + life))
}

export function strainLabel(score: number): 'low' | 'moderate' | 'high' {
  if (score < 9) return 'low'
  if (score <= 14) return 'moderate'
  return 'high'
}

export function formatStrainForPrompt(strain: number | null): string {
  if (strain == null) return ''
  return `Daily Strain: ${strain}/21 (${strainLabel(strain)})`
}

export function formatStrainHistoryForPrompt(
  history: Array<{ date: string; strain: number | null }>,
): string {
  if (history.length < 2) return ''
  const scores = history.map(h => h.strain)
  const valid = scores.filter((s): s is number => s != null)
  if (!valid.length) return ''
  const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
  // Compare last 3 days vs first 4 days to detect trend
  const recent = scores.slice(-3).filter((s): s is number => s != null)
  const earlier = scores.slice(0, 4).filter((s): s is number => s != null)
  const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
  const earlierAvg = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : 0
  const trend = recentAvg > earlierAvg + 2 ? 'rising' : recentAvg < earlierAvg - 2 ? 'falling' : 'stable'
  const vals = scores.map(s => (s == null ? '—' : String(s))).join(' ')
  return `Strain (last ${scores.length} days): ${vals} (avg: ${avg}, trend: ${trend})`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest __tests__/lib/strain.test.ts --no-coverage
```

Expected: PASS — 13 tests passing.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add lib/strain.ts __tests__/lib/strain.test.ts
git commit -m "feat: add lib/strain.ts — computeDailyStrain, strainLabel, formatStrainForPrompt"
```

---

## Task 4: Add Strain chip to MetricsBar

**Files:**
- Modify: `components/MetricsBar.tsx`

**Context:** MetricsBar already renders CTL, ATL, Form, HRV, and Resting HR chips using the `Metric` component. Each chip is conditionally rendered based on null checks. The `wellness` prop is `ICUWellness | null` — the new fields are now on that type.

- [ ] **Step 1: Import computeDailyStrain and strainLabel**

Add to the top of `components/MetricsBar.tsx` (after the existing import):

```typescript
import { computeDailyStrain, strainLabel } from '@/lib/strain'
```

- [ ] **Step 2: Compute strain inside the component**

Inside the `MetricsBar` function body, after the `formPositive` line (line 56), add:

```typescript
const dailyStrain = computeDailyStrain(
  wellness.garmin_training_load,
  wellness.stress_avg,
)
const strainColor =
  dailyStrain === null ? 'text-gray-900'
  : strainLabel(dailyStrain) === 'low' ? 'text-emerald-600'
  : strainLabel(dailyStrain) === 'moderate' ? 'text-amber-500'
  : 'text-red-500'
```

- [ ] **Step 3: Add the Strain chip to the flex row**

After the `wellness.resting_hr` chip (line 76), add:

```tsx
{dailyStrain !== null && (
  <Metric label="Strain" value={dailyStrain} valueClass={strainColor} unit="/21" />
)}
```

- [ ] **Step 4: Verify visually**

Start the dev server (`npm run dev`), open the dashboard, and check that:
- The Strain chip appears when Garmin data is present
- It is green for low scores, amber for moderate, red for high
- It hides when both `garmin_training_load` and `stress_avg` are null

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add components/MetricsBar.tsx
git commit -m "feat: add Strain chip to MetricsBar (0-21, colour-coded)"
```

---

## Task 5: Compute strain in the briefing route

**Files:**
- Modify: `app/api/briefing/today/route.ts:77–109`

**Context:** The briefing route fetches 7 days of wellness from intervals.icu. The `latest` wellness entry is used for CTL/ATL/HRV. We need to compute today's strain from `latest` and build a 7-day history from the full `wellness` array.

- [ ] **Step 1: Import computeDailyStrain**

At the top of `app/api/briefing/today/route.ts`, add to the imports:

```typescript
import { computeDailyStrain } from '@/lib/strain'
```

- [ ] **Step 2: Declare strain variables before the ICU block**

In the briefing route, before the `if (profile?.intervals_icu_athlete_id...)` block, add:

```typescript
let dailyStrain: number | null = null
let strainHistory: Array<{ date: string; strain: number | null }> = []
```

- [ ] **Step 3: Compute strain after the wellness fetch**

Inside the `try` block that fetches wellness (after line 97, where `hrv = latest?.hrv ?? null`), add:

```typescript
dailyStrain = computeDailyStrain(
  latest?.garmin_training_load ?? null,
  latest?.stress_avg ?? null,
)
strainHistory = wellness.map(w => ({
  date: w.id,
  strain: computeDailyStrain(w.garmin_training_load, w.stress_avg),
}))
```

- [ ] **Step 4: Pass strain into the BriefingContext**

Find where the `BriefingContext` object is assembled in this route (search for `readinessLabel`). Add the two new fields:

```typescript
dailyStrain,
strainHistory,
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors — `dailyStrain` and `strainHistory` match the types added in Task 1.

- [ ] **Step 6: Commit**

```bash
git add app/api/briefing/today/route.ts
git commit -m "feat: compute dailyStrain and strainHistory in briefing route"
```

---

## Task 6: Extend buildLoadString and update readiness verdict

**Files:**
- Modify: `lib/claude/briefing.ts`

**Context:** `buildLoadString` (line 41) builds the load context string passed to Claude. `SYSTEM_MORNING` (line 35) defines the readiness verdict rules — currently HRV-only. We extend both.

- [ ] **Step 1: Import strain helpers**

At the top of `lib/claude/briefing.ts`, add to imports:

```typescript
import { formatStrainForPrompt, formatStrainHistoryForPrompt, strainLabel } from '@/lib/strain'
```

- [ ] **Step 2: Extend buildLoadString to include strain**

Replace the existing `buildLoadString` function (lines 41–50):

```typescript
function buildLoadString(ctx: BriefingContext): string {
  const strainLine = ctx.dailyStrain != null
    ? formatStrainForPrompt(ctx.dailyStrain)
    : null

  const strainHistoryLine = ctx.strainHistory && ctx.strainHistory.length > 1
    ? formatStrainHistoryForPrompt(ctx.strainHistory)
    : null

  return [
    ctx.ctl !== null ? `Fitness (CTL): ${Math.round(ctx.ctl)}` : null,
    ctx.atl !== null ? `Fatigue (ATL): ${Math.round(ctx.atl)}` : null,
    ctx.tsb !== null ? `Form (TSB): ${Math.round(ctx.tsb)}` : null,
    ctx.hrvStatus ? formatHrvForPrompt(ctx.hrvStatus)
      : ctx.hrv !== null ? `HRV: ${Math.round(ctx.hrv)} ms` : null,
    `Readiness: ${ctx.readinessLabel}`,
    strainLine,
    strainHistoryLine,
  ].filter(Boolean).join(', ')
}
```

- [ ] **Step 3: Update the readiness verdict in SYSTEM_MORNING**

Find `SYSTEM_MORNING` (line 35). At the end of the existing HRV verdict guidance, add a new sentence about strain. The existing text ends with `"...the verdict reflects physiological readiness only."` — extend it:

```
Also factor in the athlete's Daily Strain score when provided (0–21 scale where 0 = no load, 21 = maximum strain). Strain ≥ 15 should push the verdict toward amber; strain ≥ 18 should push toward red and suggest swapping today's session for a recovery ride, unless the athlete's HRV is elevated (well-recovered). Strain < 9 combined with positive form (TSB > 0) supports a green verdict even for hard sessions.
```

The full SYSTEM_MORNING string should have this sentence appended before the final `"`.

- [ ] **Step 4: Run the briefing test suite**

```bash
npx jest __tests__/lib/claude-briefing.test.ts --no-coverage
```

Expected: PASS — existing tests still pass (strain fields default to `null` in test fixtures, so `buildLoadString` output is unchanged for those cases).

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Fix BriefingContext fixtures in briefing tests**

Open `__tests__/lib/claude-briefing.test.ts`. The two base contexts (`basePostRideCtx`, `baseMorningCtx`) need `dailyStrain: null` added. Find each context object and add:

```typescript
dailyStrain: null,
```

Re-run tests to confirm they still pass:

```bash
npx jest __tests__/lib/claude-briefing.test.ts --no-coverage
```

- [ ] **Step 7: Commit**

```bash
git add lib/claude/briefing.ts __tests__/lib/claude-briefing.test.ts
git commit -m "feat: extend buildLoadString with strain score and update readiness verdict thresholds"
```

---

## Task 7: Add strain to dossier / other prompt surfaces

**Files:**
- Modify: `lib/claude/dossier.ts` (or whichever file builds the athlete-state block for plan/coach chat)

**Context:** The dossier (`lib/claude/dossier.ts`) builds a static prose block from the Supabase `athlete_dossier` table. The strain trend (7-day history) is a runtime metric, not a stored document. It lives in `BriefingContext.strainHistory`. For surfaces beyond the briefing (plan chat, coach chat, session chat), the strain data reaches Claude via `buildLoadString` — no additional change needed there. The one gap is the dossier's own `formatDossier` function, which does not currently include any load metrics. We will NOT change `formatDossier` — that is the wrong layer. Instead, we verify that `buildLoadString` is called on all surfaces that have access to `BriefingContext`.

- [ ] **Step 1: Verify strain reaches plan chat**

Search for where `buildLoadString` or `BriefingContext` are used in the plan-chat builder:

```bash
grep -r "buildLoadString\|BriefingContext\|dailyStrain" app/api/chat lib/claude --include="*.ts" -l
```

For each file that uses `BriefingContext`, check that `dailyStrain` is being passed. If a file constructs a `BriefingContext` manually (not via the briefing route), add `dailyStrain: null` as a safe default.

- [ ] **Step 2: Fix any call sites that construct BriefingContext without dailyStrain**

For each file found in Step 1 that constructs a `BriefingContext` object, add:

```typescript
dailyStrain: null,
```

This is safe — `buildLoadString` already guards for `null`.

- [ ] **Step 3: Fix any remaining test fixtures**

```bash
npx jest --no-coverage 2>&1 | grep -E "FAIL|dailyStrain|Property"
```

If type errors appear in test fixtures missing `dailyStrain`, add `dailyStrain: null` to those fixtures.

- [ ] **Step 4: Run the full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Final type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: thread dailyStrain through all BriefingContext call sites"
```

---

## Verification Checklist

After all tasks are complete, confirm end-to-end behaviour:

1. **API field names confirmed:** The `console.log` in Task 2 Step 2 showed actual field names from the intervals.icu wellness API; the mapping was updated if needed; the log was removed before commit.

2. **Strain chip appears:** Open the dashboard — the MetricsBar shows a "Strain" chip with a value and `/21` unit. It is green, amber, or red based on the score.

3. **Chip hidden when no data:** If `garmin_training_load` and `stress_avg` are both null in wellness, the chip does not render.

4. **Math spot-check:** `computeDailyStrain(220, 54)` → 11, amber. `computeDailyStrain(0, 80)` → 6, green. `computeDailyStrain(600, 100)` → 21, red.

5. **Briefing includes strain:** Open a daily briefing API response (`/api/briefing/today`) and confirm the prompt contains "Daily Strain: X/21".

6. **7-day history in prompt:** The briefing prompt contains "Strain (last 7 days): …".

7. **Readiness verdict responds to strain:** In test data, set `dailyStrain: 18` — the SYSTEM_MORNING guidance now tells Claude to push toward red and suggest a recovery ride.

8. **All tests pass:** `npx jest --no-coverage` is green.

9. **No type errors:** `npx tsc --noEmit` is clean.
