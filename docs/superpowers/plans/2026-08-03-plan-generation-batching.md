# Batched Plan Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop long training plan generation from crashing on Vercel's serverless timeout, and make generation noticeably faster.

**Architecture:** Split plan generation into sequential 4-week-batch HTTP requests (each a fresh serverless invocation with its own time budget), compute periodization phases deterministically in code instead of asking Claude to decide them per call, carry prior-batch workouts/TSS forward for load continuity, and cap the generation call's extended-thinking budget.

**Tech Stack:** Next.js App Router route handlers, Anthropic SDK (`@anthropic-ai/sdk`, `claude-opus-5`), TypeScript, Jest + React Testing Library.

## Global Constraints

- Every task must leave `npm run test:ci` passing after its final commit.
- Batch size is fixed at 4 weeks and applies to every plan regardless of length — a plan of 4 weeks or fewer is a single batch (per `docs/superpowers/specs/2026-08-03-plan-generation-batching-design.md`).
- Any batch failing aborts the whole generation — no partial plans are ever approved or saved.
- The plan-generation Claude call uses `thinking: { type: 'enabled', budget_tokens: 4000 }`, explicitly overriding this repo's "adaptive thinking by default" policy for this one call site only.
- Periodization phases (`base`/`build`/`peak`/`taper`) are computed deterministically in code from `CLAUDE.md`'s phase-duration matrix — Claude is never asked to decide or return `week_phases`/`phase` again.

---

## Task 1: Deterministic phase computation and batch boundaries

**Files:**
- Modify: `lib/plan/phases.ts`
- Test: `__tests__/lib/plan-phases.test.ts`

**Interfaces:**
- Produces: `computeWeekPhases(totalWeeks: number): PlanPhase[]` and `buildPlanBatches(totalWeeks: number, batchSize?: number): Array<{ startWeek: number; weekCount: number }>`, both exported from `lib/plan/phases.ts`. Task 2 imports `computeWeekPhases`; Task 4 imports both.

- [ ] **Step 1: Write the failing tests**

Add to the end of `__tests__/lib/plan-phases.test.ts` (after the existing `getCurrentPhase` describe block):

```ts
describe('computeWeekPhases', () => {
  it('matches the CLAUDE.md matrix exactly for a 4-week plan', () => {
    expect(computeWeekPhases(4)).toEqual(['base', 'build', 'build', 'taper'])
  })

  it('matches the CLAUDE.md matrix exactly for a 12-week plan', () => {
    expect(computeWeekPhases(12)).toEqual([
      'base', 'base', 'base', 'base',
      'build', 'build', 'build', 'build', 'build',
      'peak',
      'taper', 'taper',
    ])
  })

  it('extends base by one week for 13 weeks (nearest anchor is 12)', () => {
    expect(computeWeekPhases(13)).toEqual([
      'base', 'base', 'base', 'base', 'base',
      'build', 'build', 'build', 'build', 'build',
      'peak',
      'taper', 'taper',
    ])
  })

  it('clamps base to 1 week and borrows the rest from build for a very short plan', () => {
    // Nearest anchor to 3 is 4 (base 1, build 2, peak 0, taper 1). delta = -1.
    // base would go to 0, so it clamps to 1 and build absorbs the remaining -1 (2 -> 1).
    expect(computeWeekPhases(3)).toEqual(['base', 'build', 'taper'])
  })

  it('always returns exactly totalWeeks entries', () => {
    for (const weeks of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      expect(computeWeekPhases(weeks)).toHaveLength(weeks)
    }
  })
})

describe('buildPlanBatches', () => {
  it('splits an exact multiple of 4 weeks into equal 4-week batches', () => {
    expect(buildPlanBatches(12)).toEqual([
      { startWeek: 0, weekCount: 4 },
      { startWeek: 4, weekCount: 4 },
      { startWeek: 8, weekCount: 4 },
    ])
  })

  it('gives the last batch the remainder when weeks is not a multiple of 4', () => {
    expect(buildPlanBatches(10)).toEqual([
      { startWeek: 0, weekCount: 4 },
      { startWeek: 4, weekCount: 4 },
      { startWeek: 8, weekCount: 2 },
    ])
  })

  it('produces a single batch for a plan of 4 weeks or fewer', () => {
    expect(buildPlanBatches(4)).toEqual([{ startWeek: 0, weekCount: 4 }])
    expect(buildPlanBatches(1)).toEqual([{ startWeek: 0, weekCount: 1 }])
  })
})
```

Also update the import at the top of the file:

```ts
import { derivePhases, resolvePhases, getCurrentPhase, computeWeekPhases, buildPlanBatches } from '@/lib/plan/phases'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest plan-phases.test.ts -t "computeWeekPhases|buildPlanBatches"`
Expected: FAIL with `computeWeekPhases is not a function` / `buildPlanBatches is not a function`

- [ ] **Step 3: Implement `computeWeekPhases` and `buildPlanBatches`**

Add to the end of `lib/plan/phases.ts` (after `getCurrentPhase`):

```ts
interface PhaseAnchor { weeks: number; base: number; build: number; peak: number; taper: number }

// CLAUDE.md's phase-duration matrix, as data. Anchors the plan length -> phase-week-count
// mapping; computeWeekPhases interpolates for lengths that don't match a row exactly.
const PHASE_MATRIX: PhaseAnchor[] = [
  { weeks: 4, base: 1, build: 2, peak: 0, taper: 1 },
  { weeks: 6, base: 2, build: 2, peak: 1, taper: 1 },
  { weeks: 8, base: 2, build: 3, peak: 1, taper: 2 },
  { weeks: 10, base: 3, build: 4, peak: 1, taper: 2 },
  { weeks: 12, base: 4, build: 5, peak: 1, taper: 2 },
  { weeks: 16, base: 6, build: 6, peak: 2, taper: 2 },
  { weeks: 20, base: 8, build: 7, peak: 2, taper: 3 },
]

/**
 * Deterministic whole-plan phase schedule from CLAUDE.md's phase-duration matrix —
 * computed in code (not decided by Claude) so every generation batch sees the same
 * fixed periodization regardless of how many Claude calls the plan is split across.
 * Finds the nearest anchor row by week distance (ties go to the smaller anchor),
 * then adjusts the base-phase count by the difference (compressing base for shorter
 * plans, extending it for longer ones, per CLAUDE.md's "compress base first" rule),
 * clamping base to a minimum of 1 week and moving any remaining deficit onto build.
 */
export function computeWeekPhases(totalWeeks: number): PlanPhase[] {
  let nearest = PHASE_MATRIX[0]
  let nearestDist = Math.abs(totalWeeks - nearest.weeks)
  for (const row of PHASE_MATRIX.slice(1)) {
    const dist = Math.abs(totalWeeks - row.weeks)
    if (dist < nearestDist) { nearest = row; nearestDist = dist }
  }
  const delta = totalWeeks - nearest.weeks
  let base = nearest.base + delta
  let build = nearest.build
  if (base < 1) {
    build += base - 1
    base = 1
  }
  const phases: PlanPhase[] = [
    ...Array(base).fill('base'),
    ...Array(Math.max(0, build)).fill('build'),
    ...Array(nearest.peak).fill('peak'),
    ...Array(nearest.taper).fill('taper'),
  ]
  while (phases.length < totalWeeks) phases.unshift('base')
  return phases.slice(0, totalWeeks)
}

/**
 * Splits a plan into fixed-size week batches (default 4 weeks), 0-based like
 * WeekBucket.weekIndex elsewhere in this codebase. Each generation batch becomes its
 * own HTTP request, so no single request risks the serverless function's time limit
 * regardless of total plan length.
 */
export function buildPlanBatches(
  totalWeeks: number,
  batchSize = 4,
): Array<{ startWeek: number; weekCount: number }> {
  const batches: Array<{ startWeek: number; weekCount: number }> = []
  for (let start = 0; start < totalWeeks; start += batchSize) {
    batches.push({ startWeek: start, weekCount: Math.min(batchSize, totalWeeks - start) })
  }
  return batches
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest plan-phases.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones)

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors

```bash
git add lib/plan/phases.ts __tests__/lib/plan-phases.test.ts
git commit -m "feat: deterministic phase schedule and batch boundaries for plan generation"
```

---

## Task 2: Batch-aware prompt building and capped thinking budget

**Files:**
- Modify: `lib/claude/plan.ts`
- Test: `__tests__/lib/claude-plan.test.ts`

**Interfaces:**
- Consumes: `computeWeekPhases` from Task 1 (`@/lib/plan/phases`); `addDaysUtc` from `@/lib/plan/forecast` (existing, unmodified export: `addDaysUtc(dateStr: string, n: number): string`).
- Produces: exported `PlanBatchInfo` interface `{ batchStartWeek: number; batchWeekCount: number; priorWorkouts: GeneratedPlan['workouts'] }` and exported `estimateTss(steps: Array<{ duration_minutes: number; power_pct_ftp: number }>): number`, both from `lib/claude/plan.ts`. `createPlanStream` gains a new optional 9th parameter `batchInfo?: PlanBatchInfo` (all existing call sites — `createExtendStream`, `generatePlan`, and pre-Task-3 tests — keep compiling and behaving identically since it defaults to a single full-plan batch when omitted). Task 3 (`app/api/plan/route.ts`) passes `batchInfo` explicitly and imports `estimateTss`.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/claude-plan.test.ts`, after the existing `describe('createPlanStream — dossier injection', ...)` block (before `describe('generatePlan — multi-day and continue-training holiday events', ...)`):

```ts
describe('createPlanStream — batching', () => {
  it('passes an explicit capped thinking budget', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01')
    const call = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0]
    expect(call.thinking).toEqual({ type: 'enabled', budget_tokens: 4000 })
  })

  it('defaults to a single full-plan batch when no batch info is given', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01')
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(prompt).toContain('Generate all 12 weeks now.')
    expect(prompt).not.toContain('PLAN SO FAR')
    expect(prompt).toContain('"rationale"')
  })

  it('scopes a middle batch to its own week range and flags the plan continues', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01', '', '', null, null, {
      batchStartWeek: 4, batchWeekCount: 4, priorWorkouts: [],
    })
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(prompt).toContain('Generate only weeks 5-8 now')
    expect(prompt).toContain('do not taper or wind the training down')
  })

  it('flags the final batch as the end of the plan (no continuation warning)', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01', '', '', null, null, {
      batchStartWeek: 8, batchWeekCount: 4, priorWorkouts: [],
    })
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(prompt).toContain('Generate only weeks 9-12 now')
    expect(prompt).not.toContain('do not taper or wind the training down')
  })

  it('includes a PLAN SO FAR summary of prior workouts for a later batch', () => {
    const priorWorkouts = [
      {
        date: '2026-06-01', type: 'endurance' as const, duration_minutes: 60, description: 'd', target_zones: 'z',
        steps: [{ label: 'Main', duration_minutes: 60, power_pct_ftp: 70 }],
      },
    ]
    createPlanStream(profile, syncData, 12, '2026-06-01', '', '', null, null, {
      batchStartWeek: 4, batchWeekCount: 4, priorWorkouts,
    })
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(prompt).toContain('PLAN SO FAR')
    expect(prompt).toContain('Week 1: 1 session')
  })

  it('lists the fixed phase for each week in the batch', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01', '', '', null, null, {
      batchStartWeek: 4, batchWeekCount: 4, priorWorkouts: [],
    })
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    // computeWeekPhases(12) = 4x base, 5x build, 1x peak, 2x taper -> week 5 (index 4) is the first build week
    expect(prompt).toContain('Week 5: build')
  })

  it('omits rationale/target_event fields from the requested schema for a non-first batch', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01', '', '', null, null, {
      batchStartWeek: 4, batchWeekCount: 4, priorWorkouts: [],
    })
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(prompt).not.toContain('"rationale"')
  })
})

describe('estimateTss', () => {
  it('estimates TSS from a single full-power-hour step as 100', () => {
    expect(estimateTss([{ duration_minutes: 60, power_pct_ftp: 100 }])).toBe(100)
  })

  it('sums TSS across multiple steps', () => {
    const steps = [
      { duration_minutes: 15, power_pct_ftp: 60 },
      { duration_minutes: 30, power_pct_ftp: 90 },
      { duration_minutes: 15, power_pct_ftp: 55 },
    ]
    expect(estimateTss(steps)).toBeGreaterThan(0)
  })
})
```

Also update the import at the top of the file:

```ts
import { generatePlan, createPlanStream, countPlannedWorkouts, estimateTss } from '@/lib/claude/plan'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest claude-plan.test.ts -t "batching|estimateTss"`
Expected: FAIL — `thinking` is `undefined`, prompt text doesn't contain the new strings, `estimateTss` is not a function

- [ ] **Step 3: Implement the batch-aware prompt building**

Add these imports near the top of `lib/claude/plan.ts` (alongside the existing imports):

```ts
import { addDaysUtc } from '@/lib/plan/forecast'
import { computeWeekPhases } from '@/lib/plan/phases'
```

Insert this new interface and these new functions immediately before the existing `function buildPrompt(` declaration:

```ts
export interface PlanBatchInfo {
  batchStartWeek: number     // 0-based offset of this batch within the whole plan
  batchWeekCount: number     // weeks generated in this call
  priorWorkouts: GeneratedPlan['workouts']   // workouts from earlier batches; [] for the first batch
}

/** Target training stress from a workout's steps — shared by prompt continuity summaries and the PATCH save path. */
export function estimateTss(steps: Array<{ duration_minutes: number; power_pct_ftp: number }>): number {
  return Math.round(
    steps.reduce((sum, s) => sum + (s.duration_minutes * 60 * (s.power_pct_ftp / 100) ** 2) / 36, 0)
  )
}

function summariseBatchWorkouts(workouts: GeneratedPlan['workouts'], planStart: string): string {
  if (!workouts.length) return 'No prior weeks yet.'
  const byWeek = new Map<number, { count: number; tss: number }>()
  for (const w of workouts) {
    const dayIndex = Math.round((Date.parse(w.date + 'T00:00:00Z') - Date.parse(planStart + 'T00:00:00Z')) / 86_400_000)
    const weekIndex = Math.floor(dayIndex / 7)
    const tss = w.steps?.length ? estimateTss(w.steps) : 0
    const entry = byWeek.get(weekIndex) ?? { count: 0, tss: 0 }
    entry.count += 1
    entry.tss += tss
    byWeek.set(weekIndex, entry)
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([wi, { count, tss }]) => `  Week ${wi + 1}: ${count} session${count === 1 ? '' : 's'}, ${Math.round(tss)} TSS`)
    .join('\n')
}

function buildPlanLengthInstruction(
  weeks: number,
  batch: PlanBatchInfo,
  batchStartDate: string,
  batchEndDate: string,
): string {
  const isFirstBatch = batch.batchStartWeek === 0
  const isLastBatch = batch.batchStartWeek + batch.batchWeekCount >= weeks
  const lines: string[] = []
  if (isFirstBatch && isLastBatch) {
    lines.push(`Generate all ${weeks} week${weeks === 1 ? '' : 's'} now.`)
  } else {
    const weekLabel = batch.batchWeekCount === 1
      ? `week ${batch.batchStartWeek + 1}`
      : `weeks ${batch.batchStartWeek + 1}-${batch.batchStartWeek + batch.batchWeekCount}`
    lines.push(`Generate only ${weekLabel} now (${batchStartDate} to ${batchEndDate} inclusive) — a later request will cover the rest of the plan.`)
    if (!isLastBatch) {
      lines.push('This is not the end of the plan — do not taper or wind the training down in these weeks.')
    }
  }
  lines.push(`Do not place any workouts before ${batchStartDate} or after ${batchEndDate}.`)
  return lines.join(' ')
}

function buildPhaseInstruction(weeks: number, batch: PlanBatchInfo): string {
  const weekPhases = computeWeekPhases(weeks)
  return Array.from({ length: batch.batchWeekCount }, (_, i) => {
    const weekNum = batch.batchStartWeek + i + 1
    return `  Week ${weekNum}: ${weekPhases[batch.batchStartWeek + i]}`
  }).join('\n')
}
```

Now replace the entire existing `buildPrompt` function (from `function buildPrompt(` through its closing `` ` `` and `}`) with:

```ts
function buildPrompt(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes: string,
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  trainingPhilosophy?: TrainingPhilosophy | null,
  batch: PlanBatchInfo = { batchStartWeek: 0, batchWeekCount: weeks, priorWorkouts: [] },
): string {
  const allEvents = [...profile.events].sort((a, b) => a.date.localeCompare(b.date))
  if (!allEvents.length) throw new Error('Cannot generate a plan: no events configured.')
  const wPerKg = (profile.current_ftp / profile.weight_kg).toFixed(2)
  const endDate = (() => {
    const d = new Date(startDate)
    d.setUTCDate(d.getUTCDate() + weeks * 7 - 1)
    return d.toISOString().split('T')[0]
  })()
  const batchStartDate = addDaysUtc(startDate, batch.batchStartWeek * 7)
  const batchEndDate = addDaysUtc(startDate, (batch.batchStartWeek + batch.batchWeekCount) * 7 - 1)
  const isFirstBatch = batch.batchStartWeek === 0

  const schema = isFirstBatch
    ? `{
  "rationale": "2-3 paragraph explanation of the plan approach and reasoning. Separate paragraphs with \\n\\n.",
  "target_event_name": "event name",
  "target_event_date": "YYYY-MM-DD",
  "workouts": [
    {
      "date": "YYYY-MM-DD",
      "type": "endurance|threshold|intervals|recovery|test",
      "duration_minutes": 90,
      "description": "what to do",
      "target_zones": "Zone 2 (55-75% FTP)",
      "steps": [
        {"label": "Warm Up", "duration_minutes": 15, "power_pct_ftp": 60},
        {"label": "Zone 2", "duration_minutes": 65, "power_pct_ftp": 70},
        {"label": "Cool Down", "duration_minutes": 10, "power_pct_ftp": 55}
      ],
      "coaching_notes": { "summary": "why this session matters today", "focus": [ {"label": "Cadence", "detail": "hold 90-95 rpm"} ] },
      "optional": false
    }
  ]
}`
    : `{
  "workouts": [
    {
      "date": "YYYY-MM-DD",
      "type": "endurance|threshold|intervals|recovery|test",
      "duration_minutes": 90,
      "description": "what to do",
      "target_zones": "Zone 2 (55-75% FTP)",
      "steps": [
        {"label": "Warm Up", "duration_minutes": 15, "power_pct_ftp": 60},
        {"label": "Zone 2", "duration_minutes": 65, "power_pct_ftp": 70},
        {"label": "Cool Down", "duration_minutes": 10, "power_pct_ftp": 55}
      ],
      "coaching_notes": { "summary": "why this session matters today", "focus": [ {"label": "Cadence", "detail": "hold 90-95 rpm"} ] },
      "optional": false
    }
  ]
}`

  return `Generate a training plan for this athlete.

ATHLETE PROFILE:
- Goals: ${profile.goals}
- FTP: ${profile.current_ftp}W | Weight: ${profile.weight_kg}kg | Power-to-weight: ${wPerKg} W/kg

TRAINING ZONES (watt ranges shown for your context only — write target_zones and descriptions using zone names and %FTP, NOT absolute watts, because the app renders live watts from the athlete's current FTP and baked-in watts go stale when FTP changes):
${formatZones(profile.current_ftp)}

${formatSchedule(profile.weekly_availability)}
${profile.min_sessions_per_week != null && profile.max_sessions_per_week != null
  ? `SESSION FREQUENCY TARGET: Aim for ${profile.min_sessions_per_week}–${profile.max_sessions_per_week} sessions per week. This is a target, not a hard rule — prioritise quality and recovery over hitting a specific number.`
  : ''}

${formatPlanCalendar(startDate, endDate, profile.weekly_availability, allEvents)}

HARD SCHEDULING CONSTRAINTS — absolute rules, never break these:
1. Only schedule workouts on days marked "train" in the EXACT PLANNING CALENDAR above. Never place a workout on a REST or BLOCKED day. Use each date's weekday from that calendar verbatim — do not work the day of week out yourself.
2. Each workout's duration_minutes must not exceed the maximum available minutes for that day. Choose the duration that best suits the session type and training phase — do not pad sessions just to fill available time.
3. Steps within each workout must sum to exactly duration_minutes.
4. All workout dates must fall on or after ${startDate}.
5. NEVER place a workout on an event date. Every event date is a blocked day — the event itself is the athlete's activity that day. No exceptions.

EVENTS (all priorities) — status shown per event below (BLOCKED = no workout may be scheduled; NOT BLOCKED continue-training holidays allow optional quality sessions only):
${allEvents.map(e => {
  const extras: string[] = []
  if (e.start_time) extras.push(`starts ${e.start_time}`)
  if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
  if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
  if (e.distance_km) extras.push(`~${e.distance_km}km`)
  if (e.estimated_tss != null) extras.push(`~${e.estimated_tss} TSS (est.)`)
  const raceTypeStr = e.type === 'race' && e.race_type ? ` — ${e.race_type.replace('_', ' ')}` : ''
  return `- ${eventDateRangeLabel(e)} ${eventBlockStatusLabel(e)}: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${extras.length ? ` | ${extras.join(', ')}` : ''}`
}).join('\n')}

EVENT PREPARATION — apply these rules around every event:

Race or sportive (type: race | sportive):
  - Event date: BLOCKED (no workout)
  - 1–2 days before: Short activation only — 40–60% of normal duration, 3–4 x 1min Z5 efforts to stay sharp, otherwise Z1–Z2
  - 3–6 days before: Reduce volume 20–30% vs preceding week; one quality session maximum
  - 2–3 days after: Easy recovery (Z1–Z2 only, 50% of normal duration), then resume normal progression

Holiday riding (type: holiday):
  - Default: every date from the start date to the end date is BLOCKED (athlete is self-directing their riding)
  - 1–2 weeks before the start date: Build aerobic volume; aim for positive or near-zero form going in
  - After the end date: Resume normal schedule
  - If continue_training is set on the event: do NOT block these dates. Instead place roughly 2 optional quality sessions per 7 days of the holiday (1 threshold + 1 interval/VO2max), each with "optional": true. Leave every other day in the window free — no mandatory endurance/recovery session. Do not apply the "build volume before / resume after" adjustment in this case, since training continues through the period.

Fitness checkpoint (type: fitness):
  - Event date: BLOCKED (no workout)
  - Treat like a B-priority race; apply race/sportive preparation rules

Priority A event — full taper:
  - Begin reducing volume 10 days out: start at 70% of peak week load, drop to 50% by day 3
  - Keep 2–3 short sharp sessions in the taper window to preserve neuromuscular readiness
  - Final 2 days: Z1–Z2 only or complete rest
  - Event date: BLOCKED

Priority B event — tune-up race:
  - Apply race/sportive preparation rules above
  - Resume build immediately after recovery days

Priority C event — training stimulus:
  - Event date: BLOCKED (even C events are not regular workout days)
  - No significant disruption to surrounding training; treat adjacent days normally

If a B or C event falls within the A event taper window, honour the A event periodization.
If ${weeks} weeks is not enough for a complete arc, compress the base phase but always preserve the taper.

GOAL INTERPRETATION — derive training emphases from the athlete's goals:
- Completion / endurance event → prioritise long Z2 volume; build toward back-to-back riding days in peak week
- Performance / speed → include threshold (Z4) and VO2max (Z5) blocks; reduce pure endurance volume
- Weight loss → maximise Z2 volume; avoid unnecessary rest days; keep intensity moderate
- Climbing → include sustained Z3–Z4 efforts; simulate long climbs in session descriptions
- Multiple goals → blend emphases proportionally

CURRENT ATHLETE STATE:
${summariseWellness(profile, syncData.wellness, hrvStatus)}
${dossierSection ? '\n' + dossierSection + '\n' : ''}
RECENT WEEKLY TRAINING LOAD:
${weeklyTssSummary(syncData.activities)}

LOAD CALIBRATION — critical: set week 1 of the plan so its total TSS closely matches the athlete's recent average weekly TSS shown above. Build from that baseline; do not start above it. If form (TSB) is significantly negative (below -15), reduce week 1 by 10–20% to allow recovery before building.

When an event week contains an event with a TSS estimate, treat that estimated TSS as part of the week's total training load. Reduce the surrounding workout load so the combined total (workouts + event) stays within the appropriate range for the training phase — do not stack a full training week on top of a hard event day.
${trainingPhilosophy ? '\n' + buildPromptWithPhilosophy(trainingPhilosophy) + '\n' : ''}
RECENT ACTIVITIES (last 10 — use these to understand training history, discipline mix, and current intensity):
${summariseActivities(syncData.activities)}
${!isFirstBatch ? `
PLAN SO FAR (weeks already generated in earlier requests for this same plan — continue this progression, do not restart it):
${summariseBatchWorkouts(batch.priorWorkouts, startDate)}
` : ''}
PLAN LENGTH: This ${weeks}-week plan runs from ${startDate} to ${endDate} inclusive. ${buildPlanLengthInstruction(weeks, batch, batchStartDate, batchEndDate)}
${notes ? `
ADDITIONAL COACHING NOTES (take these into account when designing the plan):
${notes}
` : ''}
STEP RULES:
- power_pct_ftp: recovery=50-55, endurance=60-75, tempo=76-90, threshold=91-105, VO2max=106-120, sprint=121+
- Sessions >45min must include a warm-up (10-15min at Z1-Z2) and cool-down (10min at Z1)
- For interval sessions, list each rep and each recovery period as a separate step (do not group)
- Use type: test for FTP tests, ramp tests, and any fitness assessment sessions — not intervals
- Set "optional": true only for the sparse quality sessions placed inside a continue_training holiday window; omit or set false for every other workout

${coachingNotesGuidance()}

PERIODIZATION PHASES FOR THESE WEEKS (fixed — apply these, do not choose your own phase labels):
${buildPhaseInstruction(weeks, batch)}

Return ONLY this JSON:
${schema}`
}
```

Finally, replace the existing `createPlanStream` function with:

```ts
export function createPlanStream(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes = '',
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  trainingPhilosophy?: TrainingPhilosophy | null,
  batchInfo?: PlanBatchInfo,
) {
  const batch = batchInfo ?? { batchStartWeek: 0, batchWeekCount: weeks, priorWorkouts: [] }
  const prompt = buildPrompt(profile, syncData, weeks, startDate, notes, dossierSection, hrvStatus, trainingPhilosophy, batch)
  return anthropic.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    thinking: { type: 'enabled', budget_tokens: 4000 },
    messages: [{ role: 'user', content: prompt }],
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest claude-plan.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones — `generatePlan`, `createExtendStream`/holiday, Max HR, and dossier-injection tests must still pass unchanged, since they all call `createPlanStream` without a 9th argument and get the same default single-batch behavior as before)

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors

```bash
git add lib/claude/plan.ts __tests__/lib/claude-plan.test.ts
git commit -m "feat: batch-aware plan prompt building and capped thinking budget"
```

---

## Task 3: Batch parameters on POST /api/plan

**Files:**
- Modify: `app/api/plan/route.ts`
- Test: Create `__tests__/api/plan-post-batch.test.ts`

**Interfaces:**
- Consumes: `createPlanStream`'s new `batchInfo` parameter and `estimateTss` from Task 2 (`@/lib/claude/plan`).
- Produces: `POST /api/plan`'s new request body contract — `{ syncData, totalWeeks, startDate, notes, training_philosophy, batchStartWeek, batchWeekCount, priorWorkouts }` — consumed by Task 4's `generatePlanInBatches`. Response NDJSON shape (`total`/`progress`/`done`/`error`) is unchanged.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/plan-post-batch.test.ts`:

```ts
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn() }))
jest.mock('@/lib/hrv/server', () => ({ fetchHrvStatusBestSource: jest.fn(async () => null) }))
jest.mock('@/lib/claude/dossier', () => ({ fetchDossier: jest.fn(async () => null), formatDossier: jest.fn(() => '') }))
jest.mock('@/lib/claude/athlete-model', () => ({ fetchActiveBeliefs: jest.fn(async () => null), formatAthleteModel: jest.fn(() => '') }))

const mockCreatePlanStream = jest.fn()
const mockParsePlanText = jest.fn()
const mockCountPlannedWorkouts = jest.fn(() => 10)
jest.mock('@/lib/claude/plan', () => ({
  createPlanStream: (...args: unknown[]) => mockCreatePlanStream(...args),
  parsePlanText: (...args: unknown[]) => mockParsePlanText(...args),
  countPlannedWorkouts: (...args: unknown[]) => mockCountPlannedWorkouts(...args),
  estimateTss: (steps: Array<{ duration_minutes: number; power_pct_ftp: number }>) =>
    Math.round(steps.reduce((sum, s) => sum + (s.duration_minutes * 60 * (s.power_pct_ftp / 100) ** 2) / 36, 0)),
}))

import { POST } from '@/app/api/plan/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const goodProfile = {
  goals: 'g', events: [{ name: 'E', date: '2026-09-01', type: 'sportive', priority: 'A' }],
  weekly_availability: [], current_ftp: 200, weight_kg: 70,
  intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1',
}

function makeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') return { select: () => ({ maybeSingle: async () => ({ data: goodProfile }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/plan', { method: 'POST', body: JSON.stringify(body) }) as never
}

async function readNdjson(res: Response): Promise<Array<Record<string, unknown>>> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
  }
  return buf.split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCountPlannedWorkouts.mockReturnValue(10)
  mockCreatePlanStream.mockReturnValue({
    on: (_event: string, cb: (text: string) => void) => cb('{"workouts":[{"date":"2026-06-01"}]}'),
    finalMessage: async () => ({}),
  })
  mockParsePlanText.mockImplementation((text: string) => JSON.parse(text))
})

describe('POST /api/plan — batching', () => {
  it('defaults to a single full-plan batch when no batch fields are sent', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    await POST(makeRequest({ totalWeeks: 6, startDate: '2026-06-01' }))
    expect(mockCreatePlanStream).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 6, '2026-06-01', '', expect.anything(), expect.anything(), expect.anything(),
      { batchStartWeek: 0, batchWeekCount: 6, priorWorkouts: [] },
    )
  })

  it('forwards batch fields and prior workouts for a later batch', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const priorWorkouts = [{ date: '2026-06-01', type: 'endurance', duration_minutes: 60, description: 'd', target_zones: 'z', steps: [] }]
    await POST(makeRequest({
      totalWeeks: 12, startDate: '2026-06-01', batchStartWeek: 4, batchWeekCount: 4, priorWorkouts,
    }))
    expect(mockCreatePlanStream).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 12, '2026-06-01', '', expect.anything(), expect.anything(), expect.anything(),
      { batchStartWeek: 4, batchWeekCount: 4, priorWorkouts },
    )
  })

  it('clamps an out-of-range batch window to stay inside the plan length', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    await POST(makeRequest({
      totalWeeks: 6, startDate: '2026-06-01', batchStartWeek: 4, batchWeekCount: 8, priorWorkouts: [],
    }))
    expect(mockCreatePlanStream).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 6, '2026-06-01', '', expect.anything(), expect.anything(), expect.anything(),
      { batchStartWeek: 4, batchWeekCount: 2, priorWorkouts: [] },
    )
  })

  it('reports the whole plan total regardless of which batch is requested', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({
      totalWeeks: 12, startDate: '2026-06-01', batchStartWeek: 8, batchWeekCount: 4, priorWorkouts: [],
    }))
    const events = await readNdjson(res)
    expect(mockCountPlannedWorkouts).toHaveBeenCalledWith(expect.anything(), 12, '2026-06-01')
    expect(events[0]).toEqual({ type: 'total', count: 10 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest plan-post-batch.test.ts`
Expected: FAIL — `createPlanStream` receives `weeks`-shaped legacy args, not the new batch object, and `totalWeeks`/`batchStartWeek`/`batchWeekCount`/`priorWorkouts` aren't read from the request body yet

- [ ] **Step 3: Implement batch parameters in the POST handler**

In `app/api/plan/route.ts`, update the top import line:

```ts
import { createPlanStream, parsePlanText, countPlannedWorkouts, estimateTss } from '@/lib/claude/plan'
```

Replace the `POST` function's body-parsing and `createPlanStream` call. The old code:

```ts
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { syncData, weeks = 6, startDate, notes = '', training_philosophy = null } = await req.json()
  const safeWeeks = Math.min(13, Math.max(1, Math.round(Number(weeks) || 6)))
  const safeStartDate = typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? startDate
    : new Date().toISOString().split('T')[0]
```

becomes:

```ts
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const {
    syncData, totalWeeks = 6, startDate, notes = '', training_philosophy = null,
    batchStartWeek = 0, batchWeekCount, priorWorkouts = [],
  } = await req.json()
  const safeWeeks = Math.min(13, Math.max(1, Math.round(Number(totalWeeks) || 6)))
  const safeStartDate = typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? startDate
    : new Date().toISOString().split('T')[0]
  const safeBatchStartWeek = Math.min(safeWeeks - 1, Math.max(0, Math.round(Number(batchStartWeek) || 0)))
  const safeBatchWeekCount = Math.max(
    1,
    Math.min(safeWeeks - safeBatchStartWeek, Math.round(Number(batchWeekCount) || (safeWeeks - safeBatchStartWeek)))
  )
  const safePriorWorkouts = Array.isArray(priorWorkouts) ? priorWorkouts : []
```

And the `createPlanStream(...)` call inside the `try` block:

```ts
    messageStream = createPlanStream(
      profileData,
      syncData ?? { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null },
      safeWeeks,
      safeStartDate,
      typeof notes === 'string' ? notes.trim() : '',
      [formatDossier(dossier as AthleteDossier | null), formatAthleteModel(beliefs)].filter(Boolean).join('\n\n'),
      hrvStatus,
      (training_philosophy as TrainingPhilosophy | null) ?? null,
    )
```

becomes:

```ts
    messageStream = createPlanStream(
      profileData,
      syncData ?? { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null },
      safeWeeks,
      safeStartDate,
      typeof notes === 'string' ? notes.trim() : '',
      [formatDossier(dossier as AthleteDossier | null), formatAthleteModel(beliefs)].filter(Boolean).join('\n\n'),
      hrvStatus,
      (training_philosophy as TrainingPhilosophy | null) ?? null,
      { batchStartWeek: safeBatchStartWeek, batchWeekCount: safeBatchWeekCount, priorWorkouts: safePriorWorkouts },
    )
```

Everything else in `POST` (the `totalWorkouts`/`countPlannedWorkouts` call, the `ReadableStream`/NDJSON loop, error handling) is unchanged.

Now remove the duplicate `estimateTss` from `PATCH`. The old nested definition inside `PATCH`:

```ts
  function estimateTss(steps: Array<{ duration_minutes: number; power_pct_ftp: number }>): number {
    return Math.round(
      steps.reduce((sum, s) => sum + (s.duration_minutes * 60 * (s.power_pct_ftp / 100) ** 2) / 36, 0)
    )
  }
```

Delete it entirely — `PATCH`'s call site (`w.steps?.length ? estimateTss(w.steps) : null`) now resolves to the imported `estimateTss` from `@/lib/claude/plan` instead, with identical behavior.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest plan-post-batch.test.ts plan-patch-archive.test.ts`
Expected: PASS (the new batching tests, and the existing PATCH archive-on-replace tests which exercise the `estimateTss` call site indirectly via workout insertion)

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors

```bash
git add app/api/plan/route.ts __tests__/api/plan-post-batch.test.ts
git commit -m "feat: accept batch parameters on POST /api/plan"
```

---

## Task 4: Client-side batch orchestration module

**Files:**
- Create: `lib/plan/generate-batches.ts`
- Test: Create `__tests__/lib/plan-generate-batches.test.ts`

**Interfaces:**
- Consumes: `buildPlanBatches`, `computeWeekPhases` from Task 1 (`@/lib/plan/phases`); `POST /api/plan`'s request/response contract from Task 3.
- Produces: `generatePlanInBatches(weeks: number, request: GeneratePlanRequest, callbacks: GeneratePlanCallbacks): Promise<GeneratePlanResult>`, `GeneratePlanRequest`, `GeneratePlanCallbacks`, and `GeneratePlanResult` types, all exported from `lib/plan/generate-batches.ts`. Task 5 (`app/plan/page.tsx`) imports and calls `generatePlanInBatches`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/plan-generate-batches.test.ts`:

```ts
/** @jest-environment node */
import { generatePlanInBatches } from '@/lib/plan/generate-batches'
import type { ICUSyncData, GeneratedPlan } from '@/types'

const syncData: ICUSyncData = { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null }

function workout(date: string): GeneratedPlan['workouts'][number] {
  return { date, type: 'endurance', duration_minutes: 60, description: 'd', target_zones: 'z', steps: [] }
}

function ndjsonResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map(e => JSON.stringify(e)).join('\n') + '\n'
  return new Response(body, { status: 200 })
}

describe('generatePlanInBatches', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
  })

  it('makes one request per 4-week batch and merges their workouts', async () => {
    const batch0Workout = workout('2026-06-01')
    const batch1Workout = workout('2026-06-29')
    const bodies: Array<Record<string, unknown>> = []
    ;(global.fetch as jest.Mock).mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      bodies.push(body)
      if (body.batchStartWeek === 0) {
        return ndjsonResponse([
          { type: 'total', count: 2 },
          { type: 'done', plan: { rationale: 'r', target_event_name: 'Dragon Ride', target_event_date: '2026-09-01', workouts: [batch0Workout] } },
        ])
      }
      return ndjsonResponse([{ type: 'done', plan: { workouts: [batch1Workout] } }])
    })

    const result = await generatePlanInBatches(
      8,
      { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null },
      { onTotal: jest.fn(), onProgress: jest.fn() },
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.plan.workouts).toEqual([batch0Workout, batch1Workout])
      expect(result.plan.rationale).toBe('r')
      expect(result.plan.week_phases).toHaveLength(8)
      expect(result.plan.phase).toBe(result.plan.week_phases![0])
    }
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toMatchObject({ totalWeeks: 8, batchStartWeek: 0, batchWeekCount: 4, priorWorkouts: [] })
    expect(bodies[1]).toMatchObject({ totalWeeks: 8, batchStartWeek: 4, batchWeekCount: 4, priorWorkouts: [batch0Workout] })
  })

  it('aborts the whole generation and never fetches a later batch when a batch fails', async () => {
    const bodies: Array<Record<string, unknown>> = []
    ;(global.fetch as jest.Mock).mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      bodies.push(body)
      if (body.batchStartWeek === 0) {
        return ndjsonResponse([
          { type: 'done', plan: { rationale: 'r', target_event_name: 'E', target_event_date: '2026-09-01', workouts: [workout('2026-06-01')] } },
        ])
      }
      return ndjsonResponse([{ type: 'error', message: 'Claude API error' }])
    })

    const result = await generatePlanInBatches(
      12,
      { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null },
      { onTotal: jest.fn(), onProgress: jest.fn() },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('weeks 5-8')
      expect(result.error).toContain('Claude API error')
    }
    expect(bodies).toHaveLength(2) // never reached the third batch (weeks 9-12)
  })

  it('reports cumulative progress across batches, not per-batch', async () => {
    const onProgress = jest.fn()
    ;(global.fetch as jest.Mock).mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      if (body.batchStartWeek === 0) {
        return ndjsonResponse([
          { type: 'progress', found: 3 },
          { type: 'done', plan: { rationale: 'r', target_event_name: 'E', target_event_date: '2026-09-01', workouts: [workout('2026-06-01'), workout('2026-06-02'), workout('2026-06-03')] } },
        ])
      }
      return ndjsonResponse([
        { type: 'progress', found: 2 },
        { type: 'done', plan: { workouts: [workout('2026-06-29')] } },
      ])
    })

    await generatePlanInBatches(
      8,
      { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null },
      { onTotal: jest.fn(), onProgress },
    )

    expect(onProgress).toHaveBeenNthCalledWith(1, 3)  // batch 0: 0 completed-before + 3 found
    expect(onProgress).toHaveBeenNthCalledWith(2, 5)  // batch 1: 3 completed-before + 2 found
  })

  it('fails cleanly when a batch response is not ok', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Add and save at least one event' }), { status: 400 })
    )

    const result = await generatePlanInBatches(
      4,
      { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null },
      { onTotal: jest.fn(), onProgress: jest.fn() },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Add and save at least one event')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest plan-generate-batches.test.ts`
Expected: FAIL with `Cannot find module '@/lib/plan/generate-batches'`

- [ ] **Step 3: Implement `generatePlanInBatches`**

Create `lib/plan/generate-batches.ts`:

```ts
import type { GeneratedPlan, ICUSyncData, TrainingPhilosophy } from '@/types'
import { buildPlanBatches, computeWeekPhases } from './phases'

export interface GeneratePlanRequest {
  syncData: ICUSyncData | null
  startDate: string
  notes: string
  trainingPhilosophy: TrainingPhilosophy | null
}

export interface GeneratePlanCallbacks {
  onTotal: (count: number) => void
  onProgress: (cumulativeFound: number) => void
}

export type GeneratePlanResult =
  | { ok: true; plan: GeneratedPlan }
  | { ok: false; error: string }

interface BatchHead {
  rationale: string
  target_event_name: string
  target_event_date: string
}

/**
 * Drives plan generation as a sequence of separate HTTP requests, one per 4-week
 * batch, so no single request risks the serverless function's execution time limit
 * regardless of total plan length. Aborts the whole generation (no partial plans)
 * if any batch fails.
 */
export async function generatePlanInBatches(
  weeks: number,
  request: GeneratePlanRequest,
  callbacks: GeneratePlanCallbacks,
): Promise<GeneratePlanResult> {
  const batches = buildPlanBatches(weeks)
  let allWorkouts: GeneratedPlan['workouts'] = []
  let head: BatchHead | null = null

  for (const { startWeek, weekCount } of batches) {
    const weekLabel = weekCount === 1 ? `week ${startWeek + 1}` : `weeks ${startWeek + 1}-${startWeek + weekCount}`

    let res: Response
    try {
      res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncData: request.syncData,
          totalWeeks: weeks,
          startDate: request.startDate,
          notes: request.notes,
          training_philosophy: request.trainingPhilosophy,
          batchStartWeek: startWeek,
          batchWeekCount: weekCount,
          priorWorkouts: allWorkouts,
        }),
      })
    } catch {
      return { ok: false, error: `Network error while building ${weekLabel}` }
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, error: data.error ?? `Plan generation failed while building ${weekLabel}` }
    }
    if (!res.body) return { ok: false, error: 'No response from server' }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let batchWorkouts: GeneratedPlan['workouts'] | null = null
    let batchError: string | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          if (event.type === 'total') callbacks.onTotal(event.count)
          else if (event.type === 'progress') callbacks.onProgress(allWorkouts.length + event.found)
          else if (event.type === 'done') {
            batchWorkouts = event.plan.workouts
            if (!head) {
              head = {
                rationale: event.plan.rationale,
                target_event_name: event.plan.target_event_name,
                target_event_date: event.plan.target_event_date,
              }
            }
          } else if (event.type === 'error') {
            batchError = event.message
          }
        } catch { /* ignore malformed lines */ }
      }
    }

    if (batchError) return { ok: false, error: `Plan generation failed while building ${weekLabel}: ${batchError}` }
    if (!batchWorkouts) return { ok: false, error: `Plan generation failed while building ${weekLabel}` }
    allWorkouts = allWorkouts.concat(batchWorkouts)
  }

  if (!head) return { ok: false, error: 'Plan generation failed' }
  const phases = computeWeekPhases(weeks)
  return {
    ok: true,
    plan: { ...head, phase: phases[0], week_phases: phases, workouts: allWorkouts },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest plan-generate-batches.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors

```bash
git add lib/plan/generate-batches.ts __tests__/lib/plan-generate-batches.test.ts
git commit -m "feat: client-side batch orchestration for plan generation"
```

---

## Task 5: Wire the plan page to the batch orchestrator

**Files:**
- Modify: `app/plan/page.tsx`
- Test: `__tests__/app/plan/page.test.tsx`

**Interfaces:**
- Consumes: `generatePlanInBatches` from Task 4 (`@/lib/plan/generate-batches`).

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/app/plan/page.test.tsx`, near the top (after the existing `global.fetch` mock, before the first `describe` block), add the mock for the new module:

```ts
jest.mock('@/lib/plan/generate-batches', () => ({ generatePlanInBatches: jest.fn() }))
```

Add this import alongside the existing `PlanPage` import at the top of the file:

```ts
import { generatePlanInBatches } from '@/lib/plan/generate-batches'
```

Add a new describe block at the end of the file, after the existing `describe('My Plan tab', ...)` block:

```ts
describe('My Plan tab — batched plan generation wiring', () => {
  function mockProfileAndPlanFetch() {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/plan') return Promise.resolve({ ok: true, json: async () => ({ workouts: [] }) })
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'p1', goals: 'g', current_ftp: 200, weight_kg: 70,
          weekly_availability: [{ day: 'monday', duration_minutes: 60 }],
          events: [{ name: 'Dragon Ride', date: '2026-09-01', type: 'sportive', priority: 'A' }],
        }),
      })
    })
  }

  it('shows the approval modal when generatePlanInBatches succeeds', async () => {
    (generatePlanInBatches as jest.Mock).mockResolvedValue({
      ok: true,
      plan: {
        rationale: 'r', target_event_name: 'Dragon Ride', target_event_date: '2026-09-01',
        phase: 'base', week_phases: ['base'],
        workouts: [{ date: '2026-06-01', type: 'endurance', duration_minutes: 60, description: 'd', target_zones: 'z', steps: [] }],
      },
    })
    mockProfileAndPlanFetch()

    render(<PlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: /build new plan/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^skip$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /use this approach/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))

    expect(await screen.findByText(/New Training Plan/i)).toBeInTheDocument()
    expect(generatePlanInBatches).toHaveBeenCalledWith(
      6,
      expect.objectContaining({ startDate: expect.any(String), notes: '' }),
      expect.objectContaining({ onTotal: expect.any(Function), onProgress: expect.any(Function) }),
    )
  })

  it('shows the batch failure message on the Training Plan screen when generatePlanInBatches fails', async () => {
    (generatePlanInBatches as jest.Mock).mockResolvedValue({
      ok: false, error: 'Plan generation failed while building weeks 5-8',
    })
    mockProfileAndPlanFetch()

    render(<PlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: /build new plan/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^skip$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /use this approach/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))

    expect(await screen.findByText('Plan generation failed while building weeks 5-8')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/app/plan/page.test.tsx -t "batched plan generation wiring"`
Expected: FAIL — `startPlanGeneration` still does its own inline fetch loop, never calls the mocked `generatePlanInBatches`

- [ ] **Step 3: Wire `startPlanGeneration` to `generatePlanInBatches`**

In `app/plan/page.tsx`, add this import alongside the other `lib/plan/*` imports near the top of the file:

```ts
import { generatePlanInBatches } from '@/lib/plan/generate-batches'
```

Replace the entire existing `startPlanGeneration` function:

```ts
  async function startPlanGeneration(weeks: number, startDate: string, notes: string) {
    setShowDurationPrompt(false)
    setPlanGenNote('')
    setPlanWeeks(weeks)
    setGenerating(true)
    setWorkoutsFound(0)
    setEstimatedWorkouts(0)
    setSaveError(null)
    try {
      const profileSaved = await saveProfile()
      if (!profileSaved) { setGenerating(false); return }
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncData, weeks, startDate, notes, training_philosophy: trainingPhilosophy }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.error ?? 'Plan generation failed')
        return
      }
      if (!res.body) { setSaveError('No response from server'); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            if (event.type === 'total') setEstimatedWorkouts(event.count)
            else if (event.type === 'progress') setWorkoutsFound(event.found)
            else if (event.type === 'done') setGeneratedPlan(event.plan)
            else if (event.type === 'error') setSaveError(event.message)
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch { setSaveError('Network error during plan generation') }
    finally { setGenerating(false) }
  }
```

with:

```ts
  async function startPlanGeneration(weeks: number, startDate: string, notes: string) {
    setShowDurationPrompt(false)
    setPlanGenNote('')
    setPlanWeeks(weeks)
    setGenerating(true)
    setWorkoutsFound(0)
    setEstimatedWorkouts(0)
    setSaveError(null)
    try {
      const profileSaved = await saveProfile()
      if (!profileSaved) return
      const result = await generatePlanInBatches(
        weeks,
        { syncData, startDate, notes, trainingPhilosophy },
        { onTotal: setEstimatedWorkouts, onProgress: setWorkoutsFound },
      )
      if (result.ok) setGeneratedPlan(result.plan)
      else setSaveError(result.error)
    } catch {
      setSaveError('Network error during plan generation')
    } finally {
      setGenerating(false)
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/app/plan/page.test.tsx`
Expected: PASS (all tests in the file, including the pre-existing tab/profile/events/history tests)

- [ ] **Step 5: Full verification and commit**

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean

```bash
git add app/plan/page.tsx __tests__/app/plan/page.test.tsx
git commit -m "feat: drive plan generation through the batch orchestrator"
```

---

## Post-implementation note (not a task — informational)

`components/PlanDurationModal.tsx` shows a `timeEstimate(weeks)` string ("Generation will take 1-2/2-3/3-4 minutes") that predates this change. Actual timings after batching + the capped thinking budget haven't been measured yet, so this plan intentionally leaves that copy untouched rather than guessing new numbers — revisit it once real generation times are observed after this ships.
