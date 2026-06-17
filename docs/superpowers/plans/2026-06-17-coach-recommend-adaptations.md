# Coach Recommend Adaptations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the coach to signal after a post-ride assessment that the athlete should consider exploring training adaptations, persisting that signal to the database and surfacing it as a highlighted callout in the saved feedback state.

**Architecture:** `assessSession` in `lib/claude/session-note.ts` is changed to return structured output (`{ note, recommendAdaptations }`) via Claude tool_use. The API route stores `recommend_adaptations` in `session_feedback`. `WorkoutFeedbackTab` hydrates that value and shows a callout prompting the athlete to re-submit with the adapt checkbox when it is true.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, Anthropic SDK tool_use, Supabase, Jest + React Testing Library.

---

## File map

| File | Change |
|---|---|
| `supabase/migrations/20260617_recommend_adaptations.sql` | Create — add `recommend_adaptations` column |
| `types/index.ts` | Add `recommend_adaptations: boolean \| null` to `SessionFeedback` |
| `lib/claude/session-note.ts` | Return `SessionNoteResult` from `assessSession` using tool_use |
| `__tests__/lib/session-note.test.ts` | Full rewrite — mock `create` instead of `stream` |
| `app/api/feedback/route.ts` | Consume new return type, store `recommend_adaptations` |
| `components/WorkoutFeedbackTab.tsx` | Add `recommendAdaptations` state + callout in saved phase |
| `__tests__/components/WorkoutFeedbackTab.test.tsx` | Add 3 tests for callout visibility |

---

## Task 1: Migration + type

**Files:**
- Create: `supabase/migrations/20260617_recommend_adaptations.sql`
- Modify: `types/index.ts`

---

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260617_recommend_adaptations.sql`:

```sql
-- Coach signals whether athlete should explore training adaptations after this session.
alter table session_feedback add column if not exists recommend_adaptations boolean;
```

- [ ] **Step 2: Run the migration**

```
npx supabase db push
```

Expected: migration applied, no errors.

- [ ] **Step 3: Add `recommend_adaptations` to `SessionFeedback`**

In `types/index.ts`, find the `SessionFeedback` interface and add the new field after `coach_note_rating`:

```ts
export interface SessionFeedback {
  id: string
  workout_id: string | null
  activity_id: string
  feedback_text: string
  activity_tss: number | null
  activity_avg_power: number | null
  activity_avg_hr: number | null
  proposed_adjustment: ProposedAdjustment | null
  approved: boolean | null
  created_at: string
  rpe: number | null
  feel: number | null
  completion: FeedbackCompletion | null
  tags: FeedbackTag[] | null
  mood: number | null
  coach_note: string | null
  coach_note_rating: CoachNoteRating | null
  recommend_adaptations: boolean | null
}
```

- [ ] **Step 4: Run TypeScript check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```
git add supabase/migrations/20260617_recommend_adaptations.sql types/index.ts
git commit -m "feat: add recommend_adaptations column to session_feedback"
```

---

## Task 2: Structured output from `assessSession`

**Files:**
- Modify: `lib/claude/session-note.ts`
- Modify: `__tests__/lib/session-note.test.ts`

The function currently returns `Promise<string>` using `stream()`. This task changes it to return `Promise<SessionNoteResult>` using `messages.create()` with forced tool_use, which guarantees structured JSON output.

---

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `__tests__/lib/session-note.test.ts` with:

```ts
import { assessSession } from '@/lib/claude/session-note'
import { makeWorkout } from '../support/factories'

const mockCreate = jest.fn()
jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-opus-4-8',
  anthropic: {
    messages: {
      create: mockCreate,
    },
  },
}))

import { anthropic } from '@/lib/claude/client'

const workout = makeWorkout({
  id: 'wk1',
  date: '2026-05-10',
  type: 'threshold',
  duration_minutes: 60,
  description: '2x20min at threshold',
  target_zones: 'Zone 4 (91-105% FTP)',
  status: 'completed',
})

function makeToolResponse(note: string, recommend: boolean) {
  return {
    content: [{
      type: 'tool_use',
      id: 'tu1',
      name: 'session_note',
      input: { note, recommend_adaptations: recommend },
    }],
  }
}

beforeEach(() => jest.clearAllMocks())

describe('assessSession', () => {
  it('returns note and recommendAdaptations from tool_use input', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse('Solid effort.', false))
    const result = await assessSession(workout, 'felt strong', { rpe: 7, feel: 2 }, '')
    expect(result.note).toBe('Solid effort.')
    expect(result.recommendAdaptations).toBe(false)
  })

  it('returns recommendAdaptations: true when coach flags it', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse('Good session but you\'re accumulating fatigue.', true))
    const result = await assessSession(workout, 'tired', { rpe: 9 }, '')
    expect(result.recommendAdaptations).toBe(true)
  })

  it('trims whitespace from the note', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse('  Nice work.  ', false))
    const result = await assessSession(workout, 'felt good', {}, '')
    expect(result.note).toBe('Nice work.')
  })

  it('includes session details, ride execution, and reported signals in prompt', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse('ok', false))
    const execution = 'Planned steps: Work 20min @ 95%\nActual intervals: Work 20:00 avg 248W HR 161'
    await assessSession(
      workout,
      'legs were heavy but pushed through',
      { rpe: 8, feel: 4, completion: 'as_planned', tags: ['poor_sleep'], mood: 3 },
      execution,
    )
    const call = (anthropic.messages.create as jest.Mock).mock.calls[0][0]
    const prompt = call.messages[0].content
    expect(prompt).toContain('2x20min at threshold')
    expect(prompt).toContain('Actual intervals: Work 20:00 avg 248W')
    expect(prompt).toContain('RPE 8/10')
    expect(prompt).toContain('legs 4/5')
    expect(prompt).toContain('poor sleep')
    expect(prompt).toContain('legs were heavy but pushed through')
  })

  it('uses tool_choice to force session_note tool', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse('ok', false))
    await assessSession(workout, 'fine', {}, '')
    const call = (anthropic.messages.create as jest.Mock).mock.calls[0][0]
    expect(call.tool_choice).toEqual({ type: 'tool', name: 'session_note' })
    expect(call.tools[0].name).toBe('session_note')
  })

  it('uses the opus model', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse('ok', false))
    await assessSession(workout, 'fine', {}, '')
    const call = (anthropic.messages.create as jest.Mock).mock.calls[0][0]
    expect(call.model).toBe('claude-opus-4-8')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest __tests__/lib/session-note.test.ts --no-coverage
```

Expected: FAIL — `assessSession` still returns a string, not `SessionNoteResult`.

---

- [ ] **Step 3: Rewrite `lib/claude/session-note.ts`**

Replace the entire file:

```ts
import { anthropic, MODEL } from './client'
import type { Workout, ReportedSignals } from '@/types'
import { formatReportedSignals } from './feedback-signals'

export interface SessionSignals extends ReportedSignals {
  mood?: number | null
}

export interface SessionNoteResult {
  note: string
  recommendAdaptations: boolean
}

const SYSTEM_PROMPT = `You are the athlete's cycling coach reflecting on a session they have just completed and logged feedback for.
Write a short, warm, specific assessment of how the session went — 2 to 3 sentences, plain coach's voice.
Speak directly to the athlete ("you"). Ground it in the actual execution and what they reported; don't invent data.
Acknowledge how it went and, where it helps, point to what it sets up next. No markdown, no headings, no lists — just the prose.
Also assess whether the athlete should consider exploring adaptations to their upcoming planned sessions based on this session or recent patterns.`

export async function assessSession(
  workout: Workout,
  feedbackText: string,
  signals: SessionSignals,
  rideExecution: string,
): Promise<SessionNoteResult> {
  const signalsLine = formatReportedSignals(signals)
  const moodLine = signals.mood != null ? `Mood ${signals.mood}/4` : ''
  const reported = [signalsLine, moodLine].filter(Boolean).join(' · ')

  const prompt = `Session: ${workout.date} ${workout.type} ${workout.duration_minutes}min
Planned: ${workout.description}
Target: ${workout.target_zones}
${rideExecution ? `\n${rideExecution}\n` : ''}
${reported ? `Athlete reported: ${reported}\n` : ''}Athlete feedback: "${feedbackText}"

Assess this session and indicate whether the athlete should explore adaptations to upcoming sessions.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    tools: [{
      name: 'session_note',
      description: 'Submit the session assessment and adaptation recommendation',
      input_schema: {
        type: 'object' as const,
        properties: {
          note: {
            type: 'string' as const,
            description: '2–3 sentence coach assessment of the session',
          },
          recommend_adaptations: {
            type: 'boolean' as const,
            description: 'True if the athlete should consider exploring adaptations to upcoming planned sessions',
          },
        },
        required: ['note', 'recommend_adaptations'],
      },
    }],
    tool_choice: { type: 'tool', name: 'session_note' },
    messages: [{ role: 'user', content: prompt }],
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (toolUse?.type !== 'tool_use') throw new Error('No tool_use block in response')
  const input = toolUse.input as { note: string; recommend_adaptations: boolean }
  return { note: input.note.trim(), recommendAdaptations: input.recommend_adaptations }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx jest __tests__/lib/session-note.test.ts --no-coverage
```

Expected: 6 tests pass.

- [ ] **Step 5: Run full suite**

```
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add lib/claude/session-note.ts __tests__/lib/session-note.test.ts
git commit -m "feat: assessSession returns structured note + recommendAdaptations via tool_use"
```

---

## Task 3: API route — consume new return type and store field

**Files:**
- Modify: `app/api/feedback/route.ts`

`assessSession` now returns `SessionNoteResult | null` (null on catch). The route must destructure the result and store both `coach_note` and `recommend_adaptations`.

---

- [ ] **Step 1: Update the import in `app/api/feedback/route.ts`**

The import from `@/lib/claude/session-note` is currently unused for types. No import change needed — `assessSession` is already imported from `@/lib/claude/session-note`.

- [ ] **Step 2: Update `coachNotePromise` consumption and the insert in `app/api/feedback/route.ts`**

Find these lines (around line 85 and 113–129):

```ts
  const coachNotePromise = assessSession(w, feedbackText, { ...signals, mood: mood ?? null }, rideExecution)
    .catch(() => null)
```

The call itself does not change — leave it as is.

Find this block (around line 113):

```ts
  const coachNote = await coachNotePromise

  const { data: feedback } = await supabase
    .from('session_feedback')
    .insert({
      workout_id: workoutId,
      activity_id: activityId,
      feedback_text: feedbackText,
      activity_tss: activityTSS ?? null,
      activity_avg_power: activityAvgPower ?? null,
      activity_avg_hr: activityAvgHR ?? null,
      rpe: rpe ?? null,
      feel: feel ?? null,
      completion: completion ?? null,
      tags: tags ?? null,
      mood: mood ?? null,
      coach_note: coachNote,
      proposed_adjustment: proposed,
      approved: null,
      user_id: user.id,
    })
```

Replace with:

```ts
  const coachNoteResult = await coachNotePromise

  const { data: feedback } = await supabase
    .from('session_feedback')
    .insert({
      workout_id: workoutId,
      activity_id: activityId,
      feedback_text: feedbackText,
      activity_tss: activityTSS ?? null,
      activity_avg_power: activityAvgPower ?? null,
      activity_avg_hr: activityAvgHR ?? null,
      rpe: rpe ?? null,
      feel: feel ?? null,
      completion: completion ?? null,
      tags: tags ?? null,
      mood: mood ?? null,
      coach_note: coachNoteResult?.note ?? null,
      recommend_adaptations: coachNoteResult?.recommendAdaptations ?? null,
      proposed_adjustment: proposed,
      approved: null,
      user_id: user.id,
    })
```

- [ ] **Step 3: Run TypeScript check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run full suite**

```
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```
git add app/api/feedback/route.ts
git commit -m "feat: store recommend_adaptations from coach session note"
```

---

## Task 4: WorkoutFeedbackTab callout + tests

**Files:**
- Modify: `components/WorkoutFeedbackTab.tsx`
- Modify: `__tests__/components/WorkoutFeedbackTab.test.tsx`

---

- [ ] **Step 1: Add 3 failing tests to `__tests__/components/WorkoutFeedbackTab.test.tsx`**

Append inside the existing `describe('WorkoutFeedbackTab', ...)` block, after the last test:

```ts
  it('shows adaptation callout when recommend_adaptations is true', async () => {
    const feedbackWithRecommend: SessionFeedback = {
      ...savedFeedback,
      recommend_adaptations: true,
    }
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={feedbackWithRecommend} onFeedbackSaved={() => {}} />)
    await screen.findByText('Feedback saved.')
    expect(screen.getByTestId('adapt-recommendation')).toBeInTheDocument()
  })

  it('does not show adaptation callout when recommend_adaptations is false', async () => {
    const feedbackNoRecommend: SessionFeedback = {
      ...savedFeedback,
      recommend_adaptations: false,
    }
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={feedbackNoRecommend} onFeedbackSaved={() => {}} />)
    await screen.findByText('Feedback saved.')
    expect(screen.queryByTestId('adapt-recommendation')).not.toBeInTheDocument()
  })

  it('does not show adaptation callout when recommend_adaptations is null', async () => {
    const feedbackNull: SessionFeedback = {
      ...savedFeedback,
      recommend_adaptations: null,
    }
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={feedbackNull} onFeedbackSaved={() => {}} />)
    await screen.findByText('Feedback saved.')
    expect(screen.queryByTestId('adapt-recommendation')).not.toBeInTheDocument()
  })
```

Note: the existing `savedFeedback` fixture in the test file does not have `recommend_adaptations`. The `SessionFeedback` type now requires it. Add `recommend_adaptations: null` to the `savedFeedback` fixture at the top of the file:

```ts
const savedFeedback: SessionFeedback = {
  id: 'f1', workout_id: 'w1', activity_id: 'a1', feedback_text: 'felt strong',
  activity_tss: null, activity_avg_power: null, activity_avg_hr: null,
  proposed_adjustment: null, approved: null, created_at: '2026-06-17T18:00:00Z',
  rpe: 7, feel: 2, completion: 'as_planned', tags: ['weather'], mood: 2,
  coach_note: null, coach_note_rating: null, recommend_adaptations: null,
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest __tests__/components/WorkoutFeedbackTab.test.tsx --no-coverage
```

Expected: 3 new tests FAIL — `adapt-recommendation` testid not found.

---

- [ ] **Step 3: Add `recommendAdaptations` state to `WorkoutFeedbackTab`**

In `components/WorkoutFeedbackTab.tsx`, after the `approving` state declaration (line ~55), add:

```ts
  const [recommendAdaptations, setRecommendAdaptations] = useState(false)
```

---

- [ ] **Step 4: Hydrate `recommendAdaptations` in the `useEffect`**

Inside the `useEffect` block, after `setSavedFeedbackId(existingFeedback.id)`, add:

```ts
    setRecommendAdaptations(existingFeedback.recommend_adaptations ?? false)
```

---

- [ ] **Step 5: Capture `recommendAdaptations` from POST response**

In `submitFeedback()`, in the `if (res.ok)` block, after `setCoachNote(data.feedback?.coach_note ?? null)`, add:

```ts
        setRecommendAdaptations(data.feedback?.recommend_adaptations ?? false)
```

---

- [ ] **Step 6: Add the callout to the saved phase render**

In the saved phase render (the final `return` block), after the `CoachNotePanel` block and before the `<label>` for the adapt checkbox, insert:

```tsx
      {recommendAdaptations && (
        <div
          data-testid="adapt-recommendation"
          className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3"
        >
          <span className="text-amber-500 text-base leading-none mt-0.5" aria-hidden="true">💡</span>
          <p className="text-sm text-amber-800 leading-relaxed">
            Your coach thinks your upcoming sessions may benefit from adjustment.
            Tap <strong>Edit &amp; re-submit</strong> below and enable{' '}
            <em>Suggest adaptations</em> to explore changes.
          </p>
        </div>
      )}
```

---

- [ ] **Step 7: Run tests to confirm they pass**

```
npx jest __tests__/components/WorkoutFeedbackTab.test.tsx --no-coverage
```

Expected: all 9 tests pass (6 existing + 3 new).

- [ ] **Step 8: Run full suite**

```
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 9: Run TypeScript check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10: Commit**

```
git add components/WorkoutFeedbackTab.tsx __tests__/components/WorkoutFeedbackTab.test.tsx
git commit -m "feat: show coach adapt recommendation callout in feedback saved state"
```
