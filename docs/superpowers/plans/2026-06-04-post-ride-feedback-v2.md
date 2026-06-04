# Post-Ride Feedback v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single free-text post-ride feedback box with a structured one-card capture (RPE, legs/body feel, completion, flag tags, mood) that syncs RPE/Feel to intervals.icu, feeds Claude's adaptation and dossier reasoning, and surfaces a dashboard RPE trend strip.

**Architecture:** New nullable columns on `session_feedback` carry the structured signal. A small pure helper (`formatReportedSignals`) renders the signal into a one-line prompt string reused by both the adaptation analyser and the dossier synthesiser. The `FeedbackModal` gains the structured inputs above the existing notes textarea while keeping its `input → proposed → saved` phase machine and adapt toggle untouched. A self-fetching `RpeTrendStrip` reads the existing no-arg `GET /api/feedback` response (extended with `rpe`/`feel`) and renders an inline-SVG sparkline on the dashboard.

**Tech Stack:** Next.js App Router (route handlers), React 19 client components, TypeScript strict, Supabase (Postgres + RLS), Anthropic SDK, Tailwind v4, Jest + React Testing Library (SWC transform — `npm run typecheck` is the real type gate).

---

## File Structure

**Create:**
- `supabase/migrations/20260604_feedback_structured.sql` — add 5 nullable columns to `session_feedback`
- `lib/claude/feedback-signals.ts` — pure `formatReportedSignals(...)` helper + label/tag maps
- `components/RpeTrendStrip.tsx` — self-fetching dashboard sparkline
- `__tests__/lib/feedback-signals.test.ts`
- `__tests__/lib/intervals-update-activity-feel.test.ts`
- `__tests__/components/FeedbackModal.test.tsx`
- `__tests__/components/RpeTrendStrip.test.tsx`

**Modify:**
- `types/index.ts` — `FeedbackCompletion`, `FeedbackTag` types; extend `SessionFeedback`, `CoachingLogEntry`
- `supabase/schema.sql` — extend `session_feedback` create + migration comment
- `lib/intervals/client.ts` — add `updateActivityFeel`
- `lib/claude/feedback.ts` — `analyseFeedback` gains a `reported` arg; prompt uses the signal line
- `lib/claude/dossier.ts` — `generateDossier` feedbacks shape + `feedbackSection` render
- `lib/claude/synthesize-dossier.ts` — select new columns, map into `generateDossier`
- `lib/plan/coaching-log.ts` — `FeedbackRow` + `toCoachingLogEntries` carry `rpe`/`feel`
- `__tests__/lib/coaching-log.test.ts` — update expectations for new fields
- `app/api/feedback/route.ts` — persist structured fields, pass to analyser, ICU push, GET no-arg select
- `components/FeedbackModal.tsx` — structured inputs, save-enable, edit seeding, saved summary
- `app/dashboard/page.tsx` — mount `RpeTrendStrip`

---

## Task 1: Types + migration + schema

**Files:**
- Modify: `types/index.ts:147-169`
- Create: `supabase/migrations/20260604_feedback_structured.sql`
- Modify: `supabase/schema.sql:70-82`

- [ ] **Step 1: Add the field vocab types and extend `SessionFeedback`**

In `types/index.ts`, immediately above `export interface SessionFeedback` (line 147), add:

```ts
export type FeedbackCompletion = 'as_planned' | 'cut_short' | 'went_harder' | 'modified'
export type FeedbackTag = 'niggle' | 'illness' | 'poor_sleep' | 'mechanical' | 'weather' | 'fuelling'
```

Then extend `SessionFeedback` (keep all existing fields) by adding these five before the closing brace:

```ts
  rpe: number | null
  feel: number | null
  completion: FeedbackCompletion | null
  tags: FeedbackTag[] | null
  mood: number | null
```

(`CoachingLogEntry` gains its `rpe`/`feel` fields later, in Task 5, alongside the
mapper change and its fixture update — adding them here would break the typed
`CoachingLog` test fixture before the mapper produces them.)

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260604_feedback_structured.sql`:

```sql
-- Structured post-ride feedback signal (all optional, additive).
alter table session_feedback add column if not exists rpe smallint;
alter table session_feedback add column if not exists feel smallint;
alter table session_feedback add column if not exists completion text;
alter table session_feedback add column if not exists tags text[];
alter table session_feedback add column if not exists mood smallint;
```

- [ ] **Step 3: Mirror into schema.sql**

In `supabase/schema.sql`, inside the `create table if not exists session_feedback (...)` block, add these lines just before `created_at` (line 81):

```sql
  rpe smallint,
  feel smallint,
  completion text,
  tags text[],
  mood smallint,
```

Then add a migration comment after the closing `);` of that table (after line 82):

```sql
-- Migration for existing installations (session_feedback structured fields):
-- see supabase/migrations/20260604_feedback_structured.sql
```

- [ ] **Step 4: Verify types compile**

Run: `npm run typecheck`
Expected: PASS (no errors). Nothing in source constructs a `SessionFeedback` object literal (it is only ever read from Supabase responses typed loosely), so adding required fields to the interface is a clean type-only change.

- [ ] **Step 5: Commit**

```bash
git add types/index.ts supabase/migrations/20260604_feedback_structured.sql supabase/schema.sql
git commit -m "feat: add structured feedback columns and types"
```

---

## Task 2: `formatReportedSignals` helper

**Files:**
- Create: `lib/claude/feedback-signals.ts`
- Test: `__tests__/lib/feedback-signals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/feedback-signals.test.ts`:

```ts
import { formatReportedSignals } from '@/lib/claude/feedback-signals'

describe('formatReportedSignals', () => {
  it('renders all signals as a single dot-separated line', () => {
    expect(formatReportedSignals({
      rpe: 7, feel: 2, completion: 'cut_short', tags: ['poor_sleep', 'niggle'],
    })).toBe('RPE 7/10 · legs 2/5 · cut short · flags: poor sleep, niggle')
  })

  it('omits null/empty parts', () => {
    expect(formatReportedSignals({ rpe: 4, feel: null, completion: null, tags: [] }))
      .toBe('RPE 4/10')
  })

  it('returns an empty string when nothing is reported', () => {
    expect(formatReportedSignals({})).toBe('')
  })

  it('maps each completion value to a readable label', () => {
    expect(formatReportedSignals({ completion: 'as_planned' })).toBe('completed as planned')
    expect(formatReportedSignals({ completion: 'went_harder' })).toBe('went harder than planned')
    expect(formatReportedSignals({ completion: 'modified' })).toBe('modified')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest __tests__/lib/feedback-signals.test.ts`
Expected: FAIL — `Cannot find module '@/lib/claude/feedback-signals'`.

- [ ] **Step 3: Implement the helper**

Create `lib/claude/feedback-signals.ts`:

```ts
import type { FeedbackCompletion, FeedbackTag } from '@/types'

const COMPLETION_LABEL: Record<FeedbackCompletion, string> = {
  as_planned: 'completed as planned',
  cut_short: 'cut short',
  went_harder: 'went harder than planned',
  modified: 'modified',
}

/**
 * One-line summary of the athlete's structured post-ride report, reused by the
 * adaptation analyser and the dossier synthesiser. Returns '' when nothing was
 * reported so callers can omit the line entirely.
 */
export function formatReportedSignals(s: {
  rpe?: number | null
  feel?: number | null
  completion?: FeedbackCompletion | null
  tags?: FeedbackTag[] | null
}): string {
  const parts: string[] = []
  if (s.rpe != null) parts.push(`RPE ${s.rpe}/10`)
  if (s.feel != null) parts.push(`legs ${s.feel}/5`)
  if (s.completion) parts.push(COMPLETION_LABEL[s.completion])
  if (s.tags?.length) parts.push(`flags: ${s.tags.map(t => t.replace(/_/g, ' ')).join(', ')}`)
  return parts.join(' · ')
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx jest __tests__/lib/feedback-signals.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/claude/feedback-signals.ts __tests__/lib/feedback-signals.test.ts
git commit -m "feat: add formatReportedSignals helper"
```

---

## Task 3: Wire structured signal into the adaptation prompt

**Files:**
- Modify: `lib/claude/feedback.ts:1-17,30-36`
- Test: `__tests__/lib/feedback-prompt.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/feedback-prompt.test.ts`. This captures the prompt sent to
Anthropic by mocking `anthropic.messages.stream` and reading its call args:

```ts
const streamMock = jest.fn()
jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-opus-4-8',
  anthropic: { messages: { stream: (...a: unknown[]) => streamMock(...a) } },
}))

import { analyseFeedback } from '@/lib/claude/feedback'
import type { Workout } from '@/types'

const workout = {
  id: 'w1', date: '2026-06-01', type: 'endurance', duration_minutes: 60,
  description: 'Easy Z2', target_zones: 'Z2',
} as unknown as Workout

beforeEach(() => {
  jest.clearAllMocks()
  streamMock.mockReturnValue({
    finalMessage: async () => ({
      content: [{ type: 'text', text: '{"summary":"none","changes":[],"workout_steps":[]}' }],
    }),
  })
})

function sentPrompt(): string {
  return streamMock.mock.calls[0][0].messages[0].content
}

describe('analyseFeedback prompt', () => {
  it('includes the reported-signal line when signals are present', async () => {
    await analyseFeedback(workout, 'felt rough', null, null, null, [], [], '', '', {
      rpe: 8, feel: 2, completion: 'cut_short', tags: ['poor_sleep'],
    })
    expect(sentPrompt()).toContain('Athlete-reported: RPE 8/10 · legs 2/5 · cut short · flags: poor sleep')
  })

  it('omits the reported-signal line when nothing is reported', async () => {
    await analyseFeedback(workout, 'fine', null, null, null, [], [], '', '', {})
    expect(sentPrompt()).not.toContain('Athlete-reported:')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest __tests__/lib/feedback-prompt.test.ts`
Expected: FAIL — `analyseFeedback` does not yet accept a 10th `reported` argument / line not present.

- [ ] **Step 3: Add the `reported` param and prompt line**

In `lib/claude/feedback.ts`, update the imports (line 2) to include the new types and helper:

```ts
import type { Workout, ProposedAdjustment, TrainingEvent, FeedbackCompletion, FeedbackTag } from '@/types'
import { formatReportedSignals } from './feedback-signals'
```

Extend the signature (after `rideExecution = '',`, line 16) with a new trailing param:

```ts
  reported: {
    rpe?: number | null
    feel?: number | null
    completion?: FeedbackCompletion | null
    tags?: FeedbackTag[] | null
  } = {},
```

Just before building `prompt` (line 30), add:

```ts
  const signalsLine = formatReportedSignals(reported)
```

Then in the prompt template, replace the `Athlete feedback:` line (line 36):

```ts
${signalsLine ? `Athlete-reported: ${signalsLine}\n` : ''}Athlete feedback: "${feedbackText}"
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx jest __tests__/lib/feedback-prompt.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → PASS

```bash
git add lib/claude/feedback.ts __tests__/lib/feedback-prompt.test.ts
git commit -m "feat: fold structured signal into feedback adaptation prompt"
```

---

## Task 4: Surface structured signal in the dossier

**Files:**
- Modify: `lib/claude/dossier.ts:69-101` (feedbacks param + feedbackSection)
- Modify: `lib/claude/synthesize-dossier.ts:35-39,70`
- Test: `__tests__/lib/dossier-feedback.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/dossier-feedback.test.ts`:

```ts
import { formatDossierFeedbackSection } from '@/lib/claude/dossier'

describe('formatDossierFeedbackSection', () => {
  it('prefixes the structured signal before the free text', () => {
    const out = formatDossierFeedbackSection([
      { created_at: '2026-06-01T18:00:00Z', feedback_text: 'legs were empty',
        rpe: 7, feel: 2, completion: 'cut_short', tags: ['poor_sleep'] },
    ])
    expect(out).toBe('2026-06-01: RPE 7/10 · legs 2/5 · cut short · flags: poor sleep "legs were empty"')
  })

  it('falls back to just the quoted text when no signal present', () => {
    const out = formatDossierFeedbackSection([
      { created_at: '2026-06-01T18:00:00Z', feedback_text: 'felt great' },
    ])
    expect(out).toBe('2026-06-01: "felt great"')
  })

  it('returns the empty-state string when there is no feedback', () => {
    expect(formatDossierFeedbackSection([])).toBe('No session feedback recorded.')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest __tests__/lib/dossier-feedback.test.ts`
Expected: FAIL — `formatDossierFeedbackSection` is not exported.

- [ ] **Step 3: Extract + extend the feedback section**

In `lib/claude/dossier.ts`, add an exported helper near the top (after the imports, before `fetchDossier`), reusing the shared signal formatter:

```ts
import type { FeedbackCompletion, FeedbackTag } from '@/types'
import { formatReportedSignals } from './feedback-signals'

export interface DossierFeedback {
  created_at: string
  feedback_text: string
  rpe?: number | null
  feel?: number | null
  completion?: FeedbackCompletion | null
  tags?: FeedbackTag[] | null
}

export function formatDossierFeedbackSection(feedbacks: DossierFeedback[]): string {
  if (!feedbacks.length) return 'No session feedback recorded.'
  return feedbacks
    .map(f => {
      const sig = formatReportedSignals(f)
      return `${f.created_at.slice(0, 10)}: ${sig ? sig + ' ' : ''}"${f.feedback_text}"`
    })
    .join('\n')
}
```

Then change `generateDossier`'s `feedbacks` parameter type (line 87) from
`feedbacks: Array<{ created_at: string; feedback_text: string }>,` to:

```ts
  feedbacks: DossierFeedback[],
```

And replace the inline `feedbackSection` block (lines 99-101) with:

```ts
  const feedbackSection = formatDossierFeedbackSection(feedbacks)
```

- [ ] **Step 4: Feed the new columns from the synthesiser**

In `lib/claude/synthesize-dossier.ts`, change the `session_feedback` select (line 36) to:

```ts
      supabase.from('session_feedback')
        .select('created_at, feedback_text, rpe, feel, completion, tags')
        .eq('user_id', profile.user_id)
        .gte('created_at', ninetyDaysAgoTs)
        .order('created_at'),
```

And change the cast passed into `generateDossier` (line 70) from
`(feedbacks ?? []) as Array<{ created_at: string; feedback_text: string }>,` to:

```ts
    (feedbacks ?? []) as import('./dossier').DossierFeedback[],
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx jest __tests__/lib/dossier-feedback.test.ts __tests__/lib/synthesize-dossier.test.ts`
Expected: PASS (the synthesize test still passes — the existing fixtures omit the new fields, which are optional).
Run: `npm run typecheck` → PASS

- [ ] **Step 6: Commit**

```bash
git add lib/claude/dossier.ts lib/claude/synthesize-dossier.ts __tests__/lib/dossier-feedback.test.ts
git commit -m "feat: surface structured feedback signal in dossier synthesis"
```

---

## Task 5: Carry RPE/feel through the coaching log

**Files:**
- Modify: `types/index.ts` (`CoachingLogEntry`)
- Modify: `lib/plan/coaching-log.ts:3-10,22-34`
- Modify: `__tests__/lib/coaching-log.test.ts:4-26`
- Modify: `__tests__/components/CoachingLog.test.tsx:5-9` (typed fixture)

- [ ] **Step 1: Add the fields to `CoachingLogEntry`**

In `types/index.ts`, extend `CoachingLogEntry` (keep existing fields) by adding
before its closing brace (after `had_proposal: boolean`, line 168):

```ts
  rpe: number | null
  feel: number | null
```

- [ ] **Step 2: Keep the typed `CoachingLog` fixture compiling**

In `__tests__/components/CoachingLog.test.tsx`, the `entry` factory is typed
`(over: Partial<CoachingLogEntry>): CoachingLogEntry`. Add the new fields to its
defaults (the object on lines 5-9, after `approved: true, had_proposal: true,`):

```ts
  rpe: null, feel: null,
```

- [ ] **Step 3: Update the coaching-log unit test to expect the new fields**

In `__tests__/lib/coaching-log.test.ts`, extend the `row` factory (line 4-7) to include the new fields:

```ts
const row = (over: Partial<FeedbackRow>): FeedbackRow => ({
  id: 'f1', created_at: '2026-06-02T18:00:00Z', workout_id: 'w1',
  feedback_text: 'legs felt flat', proposed_adjustment: null, approved: null,
  rpe: null, feel: null, ...over,
})
```

And update the first test's `toEqual` (lines 20-25) to include `rpe`/`feel`, plus add an assertion that they pass through:

```ts
    const rows: FeedbackRow[] = [row({
      proposed_adjustment: { summary: 'eased Wed intervals', changes: [] },
      approved: true, rpe: 7, feel: 2,
    })]
    const [entry] = toCoachingLogEntries(rows, workouts)
    expect(entry).toEqual({
      id: 'f1', created_at: '2026-06-02T18:00:00Z',
      session_date: '2026-06-02', session_type: 'threshold',
      feedback_text: 'legs felt flat', summary: 'eased Wed intervals',
      approved: true, had_proposal: true, rpe: 7, feel: 2,
    })
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `npx jest __tests__/lib/coaching-log.test.ts`
Expected: FAIL — `FeedbackRow` has no `rpe`/`feel`; mapped entry lacks them.

- [ ] **Step 5: Extend `FeedbackRow` and the mapper**

In `lib/plan/coaching-log.ts`, add to `FeedbackRow` (after line 9, before `}`):

```ts
  rpe: number | null
  feel: number | null
```

And in `toCoachingLogEntries`, add the two fields to the returned object (after `had_proposal: ...`, line 32):

```ts
      rpe: r.rpe,
      feel: r.feel,
```

- [ ] **Step 6: Run it to confirm it passes**

Run: `npx jest __tests__/lib/coaching-log.test.ts __tests__/components/CoachingLog.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `npm run typecheck` → PASS

```bash
git add types/index.ts lib/plan/coaching-log.ts __tests__/lib/coaching-log.test.ts __tests__/components/CoachingLog.test.tsx
git commit -m "feat: carry rpe/feel through coaching-log entries"
```

---

## Task 6: intervals.icu activity Feel/RPE write-back

**Files:**
- Modify: `lib/intervals/client.ts:177-182` (add method after `getActivity`)
- Test: `__tests__/lib/intervals-update-activity-feel.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/intervals-update-activity-feel.test.ts`:

```ts
import { IntervalsClient } from '@/lib/intervals/client'

function mockFetch() {
  const fn = jest.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({}), text: async () => '',
  })
  global.fetch = fn as unknown as typeof fetch
  return fn
}

describe('IntervalsClient.updateActivityFeel', () => {
  it('PUTs icu_rpe and the mapped feel to the activity endpoint', async () => {
    const fetchFn = mockFetch()
    const client = new IntervalsClient('123', 'key')
    await client.updateActivityFeel('a1', { rpe: 7, feel: 2 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchFn.mock.calls[0]
    expect(url).toBe('https://intervals.icu/api/v1/activity/a1')
    expect(opts.method).toBe('PUT')
    // internal feel 2 (legs slightly fresh) → icu feel 4 (good) via 6 - feel
    expect(JSON.parse(opts.body)).toEqual({ icu_rpe: 7, feel: 4 })
  })

  it('sends only the fields provided', async () => {
    const fetchFn = mockFetch()
    const client = new IntervalsClient('123', 'key')
    await client.updateActivityFeel('a1', { rpe: 5, feel: null })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ icu_rpe: 5 })
  })

  it('makes no request when neither value is provided', async () => {
    const fetchFn = mockFetch()
    const client = new IntervalsClient('123', 'key')
    await client.updateActivityFeel('a1', { rpe: null, feel: null })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest __tests__/lib/intervals-update-activity-feel.test.ts`
Expected: FAIL — `updateActivityFeel` is not a function.

- [ ] **Step 3: Implement the method**

In `lib/intervals/client.ts`, add immediately after `getActivity` (after line 182):

```ts
  // Write the athlete's perceived effort + feel onto a completed activity.
  // intervals.icu activity fields: `icu_rpe` is 1–10 (higher = harder, same
  // direction as ours). `feel` is 1–5 where 5 = best/strongest; our internal
  // scale is 1 = freshest/best → 5 = empty/worst (matching the 😀→😵 faces),
  // so we invert with `6 - feel`.
  // VERIFY AT BUILD TIME: confirm intervals.icu's `feel` direction against the
  // live API (GET an activity you have rated in the ICU UI and inspect `feel`).
  // If their 1 is "best", drop the inversion and send `feel` directly.
  async updateActivityFeel(
    activityId: string,
    p: { rpe?: number | null; feel?: number | null },
  ): Promise<void> {
    const body: Record<string, unknown> = {}
    if (p.rpe != null) body.icu_rpe = p.rpe
    if (p.feel != null) body.feel = 6 - p.feel
    if (!Object.keys(body).length) return
    await this.request(`/activity/${activityId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx jest __tests__/lib/intervals-update-activity-feel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/intervals/client.ts __tests__/lib/intervals-update-activity-feel.test.ts
git commit -m "feat: add intervals.icu activity RPE/Feel write-back"
```

---

## Task 7: Wire the API route

**Files:**
- Modify: `app/api/feedback/route.ts:23-25,42-50,57,87-112`

No new unit test: the route's pure logic is already covered (helper + client + coaching-log tests), and the client→server body contract is asserted by the `FeedbackModal` test in Task 8. The gate here is `npm run typecheck` + the full suite staying green.

- [ ] **Step 1: GET no-arg — select rpe/feel for the trend strip + log**

In `app/api/feedback/route.ts`, change the no-`workoutId` select (line 23) to include the columns the coaching-log entries now carry:

```ts
      .select('id, created_at, workout_id, feedback_text, proposed_adjustment, approved, rpe, feel')
```

- [ ] **Step 2: POST — accept, analyse with, persist, and sync the structured fields**

Change the body destructure (line 57) to pull the new fields:

```ts
  const { workoutId, activityId, feedbackText, activityTSS, activityAvgPower, activityAvgHR, adapt,
          rpe, feel, completion, tags, mood } = await req.json()
```

Pass the structured signal into `analyseFeedback` — add a 10th argument to the existing call (after `rideExecution,`, line 96):

```ts
      rideExecution,
      { rpe: rpe ?? null, feel: feel ?? null, completion: completion ?? null, tags: tags ?? null },
```

Persist the new fields on insert — extend the `.insert({...})` object (after `activity_avg_hr: ...`, line 108):

```ts
      rpe: rpe ?? null,
      feel: feel ?? null,
      completion: completion ?? null,
      tags: tags ?? null,
      mood: mood ?? null,
```

- [ ] **Step 3: POST — push RPE/Feel to intervals.icu after insert**

Immediately after the `insert(...).select().single()` returns `feedback` (after line 114, before the `return NextResponse.json(...)`), add:

```ts
  // Push perceived effort + feel to the linked intervals.icu activity. Best-effort:
  // skipped for manual entries and silently ignored on any failure.
  if (activityId && activityId !== 'manual' && (rpe != null || feel != null)) {
    const { data: icuProfile } = await supabase
      .from('user_profile')
      .select('intervals_icu_athlete_id, intervals_icu_api_key')
      .maybeSingle()
    if (icuProfile?.intervals_icu_athlete_id && icuProfile?.intervals_icu_api_key) {
      await new IntervalsClient(icuProfile.intervals_icu_athlete_id, icuProfile.intervals_icu_api_key)
        .updateActivityFeel(activityId, { rpe: rpe ?? null, feel: feel ?? null })
        .catch(() => {})
    }
  }
```

(`IntervalsClient` is already imported at line 3.)

- [ ] **Step 4: Verify the whole suite + types**

Run: `npm run typecheck` → PASS
Run: `npx jest` → all suites green (note: PowerShell may print harmless `NativeCommandError` wrapper lines — judge by the `Tests:`/`Test Suites:` summary).

- [ ] **Step 5: Commit**

```bash
git add app/api/feedback/route.ts
git commit -m "feat: persist, analyse, and sync structured feedback in the API route"
```

---

## Task 8: Rebuild the FeedbackModal capture card

**Files:**
- Modify: `components/FeedbackModal.tsx` (whole file)
- Test: `__tests__/components/FeedbackModal.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/FeedbackModal.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FeedbackModal from '@/components/FeedbackModal'
import type { Workout } from '@/types'

const workout = {
  id: 'w1', date: '2026-06-01', type: 'endurance', duration_minutes: 60,
  icu_activity_id: 'a1',
} as unknown as Workout

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, json: async () => ({ feedback: { id: 'f1' }, proposed: null }),
  }) as unknown as typeof fetch
})

describe('FeedbackModal structured capture', () => {
  it('disables Save until a signal is present, then enables on RPE', () => {
    render(<FeedbackModal workout={workout} onClose={() => {}} />)
    const save = screen.getByRole('button', { name: /save feedback/i })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'RPE 7' }))
    expect(save).toBeEnabled()
  })

  it('submits the structured fields in the POST body', async () => {
    render(<FeedbackModal workout={workout} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'RPE 8' }))
    fireEvent.click(screen.getByRole('button', { name: 'cut short' }))
    fireEvent.click(screen.getByRole('button', { name: /save feedback/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toMatchObject({ workoutId: 'w1', rpe: 8, completion: 'cut_short', adapt: false })
  })

  it('seeds structured fields from initialFeedback in edit mode', () => {
    render(<FeedbackModal workout={workout} onClose={() => {}} initialFeedback={{
      id: 'f1', workout_id: 'w1', activity_id: 'a1', feedback_text: 'tough',
      activity_tss: null, activity_avg_power: null, activity_avg_hr: null,
      proposed_adjustment: null, approved: null, created_at: '2026-06-01T18:00:00Z',
      rpe: 6, feel: 3, completion: 'as_planned', tags: ['weather'], mood: 2,
    }} />)
    // The selected RPE button is marked pressed
    expect(screen.getByRole('button', { name: 'RPE 6' })).toHaveAttribute('aria-pressed', 'true')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest __tests__/components/FeedbackModal.test.tsx`
Expected: FAIL — current modal has no RPE buttons / structured fields.

- [ ] **Step 3: Rewrite the modal**

Replace the entire contents of `components/FeedbackModal.tsx` with:

```tsx
'use client'
import { useState } from 'react'
import type {
  Workout, ProposedAdjustment, SessionFeedback, FeedbackCompletion, FeedbackTag,
} from '@/types'

type Phase = 'input' | 'proposed' | 'saved'

interface Props {
  workout: Workout
  onClose: () => void
  initialFeedback?: SessionFeedback
}

const FEEL_FACES = ['😀', '🙂', '😐', '😣', '😵']         // index 0..4 → feel 1..5 (fresh→flat)
const MOOD_FACES = ['😍', '🙂', '😐', '😞']               // index 0..3 → mood 1..4 (best→worst)
const COMPLETIONS: { value: FeedbackCompletion; label: string }[] = [
  { value: 'as_planned', label: 'to plan' },
  { value: 'cut_short', label: 'cut short' },
  { value: 'went_harder', label: 'went harder' },
  { value: 'modified', label: 'modified' },
]
const TAGS: { value: FeedbackTag; label: string }[] = [
  { value: 'niggle', label: 'niggle' },
  { value: 'illness', label: 'illness' },
  { value: 'poor_sleep', label: 'poor sleep' },
  { value: 'mechanical', label: 'mechanical' },
  { value: 'weather', label: 'weather' },
  { value: 'fuelling', label: 'fuelling' },
]

export default function FeedbackModal({ workout, onClose, initialFeedback }: Props) {
  const [phase, setPhase] = useState<Phase>(() => {
    if (!initialFeedback) return 'input'
    if (initialFeedback.proposed_adjustment && initialFeedback.approved === null) return 'proposed'
    return 'input'
  })
  const [feedbackText, setFeedbackText] = useState(initialFeedback?.feedback_text ?? '')
  const [rpe, setRpe] = useState<number | null>(initialFeedback?.rpe ?? null)
  const [feel, setFeel] = useState<number | null>(initialFeedback?.feel ?? null)
  const [completion, setCompletion] = useState<FeedbackCompletion | null>(initialFeedback?.completion ?? null)
  const [tags, setTags] = useState<FeedbackTag[]>(initialFeedback?.tags ?? [])
  const [mood, setMood] = useState<number | null>(initialFeedback?.mood ?? null)
  const [proposed, setProposed] = useState<{ feedbackId: string; adjustment: ProposedAdjustment } | null>(
    initialFeedback?.proposed_adjustment && initialFeedback.approved === null
      ? { feedbackId: initialFeedback.id, adjustment: initialFeedback.proposed_adjustment }
      : null
  )
  const [adapt, setAdapt] = useState(
    initialFeedback ? initialFeedback.proposed_adjustment !== null : false
  )
  const [loading, setLoading] = useState(false)

  const hasSignal =
    rpe != null || feel != null || completion != null || tags.length > 0 || mood != null || feedbackText.trim() !== ''

  function toggleTag(t: FeedbackTag) {
    setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  async function submitFeedback() {
    if (!hasSignal) return
    setLoading(true)
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workoutId: workout.id,
        activityId: workout.icu_activity_id ?? 'manual',
        feedbackText,
        adapt,
        rpe, feel, completion, tags, mood,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      if (adapt && data.proposed) {
        setProposed({ feedbackId: data.feedback.id, adjustment: data.proposed })
        setPhase('proposed')
      } else {
        setPhase('saved')
      }
    }
    setLoading(false)
  }

  async function approveAdjustment(approve: boolean) {
    if (!proposed) return
    const res = await fetch('/api/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackId: proposed.feedbackId, approved: approve }),
    })
    if (res.ok) {
      setProposed(null)
      setPhase('saved')
    }
  }

  const segBtn = 'px-3 py-2.5 rounded-lg text-sm border transition-colors'
  const segOn = 'bg-blue-600 text-white border-blue-600'
  const segOff = 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'

  const structuredInputs = (
    <div className="space-y-4">
      {/* RPE */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Effort (RPE)</p>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              type="button"
              aria-label={`RPE ${n}`}
              aria-pressed={rpe === n}
              onClick={() => setRpe(rpe === n ? null : n)}
              className={`py-2.5 rounded-lg text-sm border transition-colors ${rpe === n ? segOn : segOff}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Legs / body feel */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Legs / body</p>
        <div className="flex gap-2">
          {FEEL_FACES.map((face, i) => {
            const value = i + 1
            return (
              <button
                key={value}
                type="button"
                aria-label={`Feel ${value}`}
                aria-pressed={feel === value}
                onClick={() => setFeel(feel === value ? null : value)}
                className={`flex-1 py-2.5 rounded-lg text-xl border transition-colors ${feel === value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                {face}
              </button>
            )
          })}
        </div>
      </div>

      {/* Completion */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Went</p>
        <div className="flex flex-wrap gap-1.5">
          {COMPLETIONS.map(c => (
            <button
              key={c.value}
              type="button"
              aria-label={c.label}
              aria-pressed={completion === c.value}
              onClick={() => setCompletion(completion === c.value ? null : c.value)}
              className={`${segBtn} ${completion === c.value ? segOn : segOff}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Flags */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Flags</p>
        <div className="flex flex-wrap gap-1.5">
          {TAGS.map(t => (
            <button
              key={t.value}
              type="button"
              aria-label={t.label}
              aria-pressed={tags.includes(t.value)}
              onClick={() => toggleTag(t.value)}
              className={`${segBtn} ${tags.includes(t.value) ? segOn : segOff}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mood */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Mood</p>
        <div className="flex gap-2">
          {MOOD_FACES.map((face, i) => {
            const value = i + 1
            return (
              <button
                key={value}
                type="button"
                aria-label={`Mood ${value}`}
                aria-pressed={mood === value}
                onClick={() => setMood(mood === value ? null : value)}
                className={`flex-1 py-2.5 rounded-lg text-xl border transition-colors ${mood === value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                {face}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  const adaptToggle = (
    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={adapt}
        onChange={e => setAdapt(e.target.checked)}
        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      Suggest adaptations for upcoming workouts
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full max-w-md p-6 space-y-4 max-h-[92vh] overflow-y-auto">
        <h2 className="font-semibold text-gray-800">Session Feedback</h2>
        <p className="text-sm text-gray-500">
          {workout.date} — {workout.type} {workout.duration_minutes}min
        </p>

        {phase === 'input' && (
          <>
            {structuredInputs}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">Notes</p>
              <textarea
                value={feedbackText}
                onChange={e => setFeedbackText(e.target.value)}
                placeholder="Anything else? (optional)"
                rows={3}
                className="w-full text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {adaptToggle}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2.5">
                Cancel
              </button>
              <button
                onClick={submitFeedback}
                disabled={loading || !hasSignal}
                className="bg-blue-600 text-white text-sm px-4 py-2.5 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Saving…' : 'Save feedback'}
              </button>
            </div>
          </>
        )}

        {phase === 'proposed' && proposed && (
          <>
            <div className="text-sm text-gray-700 bg-yellow-50 border border-yellow-200 rounded p-3">
              <p className="font-medium mb-2">Proposed adjustments:</p>
              <p>{proposed.adjustment.summary}</p>
              {proposed.adjustment.changes.map((c, i) => (
                <div key={i} className="mt-2 text-xs text-gray-600">
                  • {c.field}: {String(c.old_value)} → {String(c.new_value)} ({c.reason})
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => approveAdjustment(false)} className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2.5">
                Reject
              </button>
              <button onClick={() => approveAdjustment(true)} className="bg-blue-600 text-white text-sm px-4 py-2.5 rounded hover:bg-blue-700">
                Approve Changes
              </button>
            </div>
          </>
        )}

        {phase === 'saved' && (
          <>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm text-gray-700 space-y-1.5">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
                {rpe != null && <span>RPE {rpe}/10</span>}
                {feel != null && <span>Legs {FEEL_FACES[feel - 1]}</span>}
                {completion && <span>{COMPLETIONS.find(c => c.value === completion)?.label}</span>}
                {tags.length > 0 && <span>{tags.map(t => TAGS.find(x => x.value === t)?.label).join(', ')}</span>}
                {mood != null && <span>{MOOD_FACES[mood - 1]}</span>}
              </div>
              {feedbackText.trim() && (
                <p className="whitespace-pre-wrap leading-relaxed">{feedbackText}</p>
              )}
            </div>
            <p className="text-xs text-green-600 font-medium">Feedback saved.</p>
            {adaptToggle}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2.5">
                Close
              </button>
              <button onClick={() => setPhase('input')} className="text-sm font-medium text-blue-600 hover:text-blue-700 px-2 py-2.5">
                Edit &amp; re-submit
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx jest __tests__/components/FeedbackModal.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → PASS

```bash
git add components/FeedbackModal.tsx __tests__/components/FeedbackModal.test.tsx
git commit -m "feat: structured one-card post-ride feedback capture"
```

---

## Task 9: RPE trend sparkline component

**Files:**
- Create: `components/RpeTrendStrip.tsx`
- Test: `__tests__/components/RpeTrendStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/RpeTrendStrip.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import RpeTrendStrip from '@/components/RpeTrendStrip'

function mockEntries(entries: Array<{ created_at: string; rpe: number | null; feel: number | null }>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, json: async () => ({ entries }),
  }) as unknown as typeof fetch
}

describe('RpeTrendStrip', () => {
  it('renders the strip when at least two RPE points exist', async () => {
    mockEntries([
      { created_at: '2026-06-03T18:00:00Z', rpe: 6, feel: 2 },
      { created_at: '2026-06-01T18:00:00Z', rpe: 8, feel: 3 },
    ])
    render(<RpeTrendStrip />)
    await waitFor(() => expect(screen.getByTestId('rpe-trend-strip')).toBeInTheDocument())
  })

  it('renders nothing when fewer than two RPE points exist', async () => {
    mockEntries([
      { created_at: '2026-06-03T18:00:00Z', rpe: 6, feel: 2 },
      { created_at: '2026-06-01T18:00:00Z', rpe: null, feel: null },
    ])
    const { container } = render(<RpeTrendStrip />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('rpe-trend-strip')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest __tests__/components/RpeTrendStrip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `components/RpeTrendStrip.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'

interface Entry { created_at: string; rpe: number | null; feel: number | null }

export default function RpeTrendStrip() {
  const [points, setPoints] = useState<number[] | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/feedback')
      .then(r => r.json())
      .then((d: { entries?: Entry[] }) => {
        if (!active) return
        // entries arrive newest-first; reverse to chronological, keep RPE values only
        const rpes = (d.entries ?? [])
          .slice()
          .reverse()
          .map(e => e.rpe)
          .filter((v): v is number => v != null)
        setPoints(rpes)
      })
      .catch(() => { if (active) setPoints([]) })
    return () => { active = false }
  }, [])

  if (!points || points.length < 2) return null

  const w = 240, h = 36, pad = 4
  const max = 10, min = 1
  const stepX = (w - pad * 2) / (points.length - 1)
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2)
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${pad + i * stepX} ${y(v)}`).join(' ')
  const latest = points[points.length - 1]

  return (
    <div
      data-testid="rpe-trend-strip"
      className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-4"
    >
      <div className="shrink-0">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Effort trend</p>
        <p className="text-sm text-gray-700">Last {points.length} sessions · RPE {latest}/10</p>
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="flex-1 min-w-0" aria-hidden="true">
        <path d={d} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((v, i) => (
          <circle key={i} cx={pad + i * stepX} cy={y(v)} r={2} fill="#2563eb" />
        ))}
      </svg>
    </div>
  )
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx jest __tests__/components/RpeTrendStrip.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → PASS

```bash
git add components/RpeTrendStrip.tsx __tests__/components/RpeTrendStrip.test.tsx
git commit -m "feat: add RPE trend sparkline component"
```

---

## Task 10: Mount the trend strip on the dashboard

**Files:**
- Modify: `app/dashboard/page.tsx:5-9,436-437`

- [ ] **Step 1: Import the component**

In `app/dashboard/page.tsx`, add to the component imports near the top (after line 5's `FeedbackModal` import):

```ts
import RpeTrendStrip from '@/components/RpeTrendStrip'
```

- [ ] **Step 2: Render it after the daily-briefing block**

Locate the closing `</div>` of the `{/* Daily briefing */}` block (line 436). Immediately after it, add:

```tsx
      <RpeTrendStrip />
```

- [ ] **Step 3: Typecheck + run the full suite**

Run: `npm run typecheck` → PASS
Run: `npx jest` → all suites green.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: surface RPE trend strip on the dashboard"
```

---

## Post-implementation (operational)

- **User-run migration:** `supabase/migrations/20260604_feedback_structured.sql` must be applied in Supabase before the feature works end-to-end. Until then the structured fields silently no-op (inserts of unknown columns would error — so the migration must run before deploying Task 7). Flag this to the user.
- **intervals.icu `feel` direction:** confirmed during Task 6 against the live API; if the inversion (`6 - feel`) was wrong, that single line is the only fix needed.

## Verification checklist (manual, after deploy + migration)

1. Open a completed workout → Log feedback → the one-card capture shows RPE / legs / went / flags / mood / notes.
2. Save disabled until at least one signal is set; tapping a single RPE enables it.
3. Save with adapt OFF → goes straight to the saved summary showing the chips.
4. Save with adapt ON and a fatigue signal (e.g. RPE 9 on an easy ride) → proposed adjustments reflect the reported effort.
5. Reopen → Edit & re-submit pre-fills all structured fields.
6. Check the matching intervals.icu activity shows the RPE and Feel.
7. Dashboard shows the Effort trend strip once ≥2 sessions have an RPE.
```
