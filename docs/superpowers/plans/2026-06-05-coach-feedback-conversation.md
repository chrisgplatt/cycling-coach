# Coach's Post-Ride Note → Feedback Conversation — Implementation Plan

> **For agentic workers:** TDD, bite-sized tasks, frequent commits. Steps use `- [ ]` checkboxes.

**Goal:** Every feedback submit generates a short coach assessment saved against the workout; the athlete can rate it and reply in a thread; the conversation feeds the dossier and the usefulness signal feeds the belief model.

**Architecture:** A lean `assessSession` Claude call (always-on, separate from `analyseFeedback`) writes `session_feedback.coach_note`. A `feedback_messages` table + `/api/feedback/chat` streaming route carry the two-way thread. Nightly dossier + belief synthesis read the new sources.

**Tech stack:** Next.js App Router, Supabase (Postgres + RLS), Anthropic SDK (`claude-opus-4-8`), Jest + SWC, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-05-coach-feedback-conversation-design.md`

**Commit policy for this repo:** user commits/pushes explicitly. Build + test; do not `git commit` unless asked.

---

## PHASE A — The coach's note

### Task A1: Migration + types for `coach_note`
**Files:**
- Create: `supabase/migrations/20260605_coach_note.sql`
- Modify: `types/index.ts` (`SessionFeedback`)

```sql
-- Coach's short post-ride assessment, generated on every feedback submit.
alter table session_feedback add column if not exists coach_note text;
```
- `SessionFeedback`: add `coach_note: string | null`.

### Task A2: `assessSession` (TDD)
**Files:**
- Create: `lib/claude/session-note.ts`
- Test: `__tests__/lib/session-note.test.ts`

`assessSession(workout, feedbackText, signals: ReportedSignals & { mood?: number | null }, rideExecution): Promise<string>`
- Model `claude-opus-4-8` via `anthropic.messages.stream(...).finalMessage()` (mirror `feedback.ts`).
- Prompt: workout line + target + ride execution (if any) + `formatReportedSignals` + mood + `"feedback"`. Ask for 2–3 sentence plain-prose assessment, no JSON, no markdown.
- Return trimmed text of the first text block.

Tests (mock `@/lib/claude/client` like `claude-feedback.test.ts`):
- returns the model's prose text
- includes the ride-execution block + signals in the prompt when provided
- works with empty execution / no signals (manual entry)

### Task A3: Wire `assessSession` into feedback POST
**Files:**
- Modify: `app/api/feedback/route.ts`

- Lift the `rideExecution` build above the `if (shouldAdapt)` block (it only needs the workout).
- Always compute `coachNote` via `assessSession`, wrapped in try/catch → `null` on failure. When adapting, run in parallel with `analyseFeedback` (`Promise.all`).
- Add `coach_note: coachNote` to the insert; it is already returned via `.select().single()`.

### Task A4: Display the coach's take
**Files:**
- Modify: `components/WorkoutDetailModal.tsx` (Session feedback block ~477)
- Modify: `components/FeedbackModal.tsx` (saved phase ~280)

- WorkoutDetailModal: above `feedback_text`, render a "Coach's take" sub-block when `existingFeedback.coach_note` is set (quote-styled, `whitespace-pre-wrap`).
- FeedbackModal saved phase: after submit, show `coachNote` (held in new state, set from `data.feedback.coach_note`) as a "Coach's take" block.

---

## PHASE B — The conversation

### Task B1: Migration + types for thread + rating
**Files:**
- Create: `supabase/migrations/20260605_feedback_conversation.sql`
- Modify: `types/index.ts`

```sql
alter table session_feedback add column if not exists coach_note_rating text
  check (coach_note_rating in ('helpful','not_helpful'));

create table if not exists feedback_messages (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references session_feedback(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists feedback_messages_feedback_idx
  on feedback_messages (feedback_id, created_at);
alter table feedback_messages enable row level security;
create policy "own data" on feedback_messages
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```
- `SessionFeedback`: add `coach_note_rating: 'helpful' | 'not_helpful' | null`.
- Add `FeedbackMessage { id; feedback_id; user_id; role: 'user' | 'assistant'; content; created_at }`.

### Task B2: Rating via feedback PATCH
**Files:**
- Modify: `app/api/feedback/route.ts` (PATCH)

- Add a branch at the top of PATCH: if `coachNoteRating` is present, update `session_feedback.coach_note_rating` for `feedbackId` (owner-scoped) and return `{ ok: true }` before the `approved` logic.

### Task B3: Feedback chat prompt builder (TDD)
**Files:**
- Create: `lib/claude/feedback-chat.ts`
- Test: `__tests__/lib/feedback-chat.test.ts`

`buildFeedbackChatSystemPrompt(workout, signals, rideExecution, coachNote): string` — coach persona + this session's context + the coach's note, instructed to discuss the session and respond to usefulness pushback in the athlete's coaching voice. Tests assert the session details, signals, and coach note appear.

### Task B4: `/api/feedback/chat` route
**Files:**
- Create: `app/api/feedback/chat/route.ts`

- POST `{ feedbackId, message, history }`. Auth; load the feedback row (owner-scoped) + its workout; 404/403 as needed.
- Build system prompt (B3); stream reply (mirror `/api/chat`); persist user msg before stream, assistant msg after, to `feedback_messages` (`feedback_id`, `user_id`, role, content).
- GET `?feedbackId=` → ordered `feedback_messages` for the thread (owner-scoped).

### Task B5: `FeedbackChat` component
**Files:**
- Create: `components/FeedbackChat.tsx`

- Props: `feedbackId`, `coachNote`. Renders `coachNote` as the opening assistant bubble, lazy-loads thread via GET, streams replies via POST. Mobile-first (≥44px targets, input pinned, `whitespace-pre-wrap`).

### Task B6: Wire rating + thread into the UI
**Files:**
- Modify: `components/WorkoutDetailModal.tsx`
- Modify: `components/FeedbackModal.tsx`

- Under "Coach's take": 👍/👎 rating control (PATCH `coachNoteRating`, optimistic, reads `existingFeedback.coach_note_rating`), and an expandable `FeedbackChat` (anchored to `existingFeedback.id`).
- FeedbackModal saved phase: same rating control + entry into `FeedbackChat` for the just-saved feedback id.

### Task B7: Dossier synthesis reads the conversation
**Files:**
- Modify: `lib/claude/synthesize-dossier.ts`, `lib/claude/dossier.ts`
- Test: `__tests__/lib/synthesize-dossier.test.ts`, `__tests__/lib/dossier.test.ts`

- Read `feedback_messages` (90-day window, owner) and pass a formatted conversation section into `generateDossier` as an added source. Extend `generateDossier` signature with the section; render it in the prompt. Update tests for the new read + arg.

### Task B8: Belief synthesis reads the usefulness signal
**Files:**
- Modify: `lib/claude/synthesize-beliefs.ts` + `lib/athlete-model/*` as needed
- Test: `__tests__/lib/synthesize-beliefs.test.ts`

- Pull `coach_note_rating` (+ conversation) into the read; surface a coaching-calibration belief candidate (e.g. `coaching_resonance`) from the helpful/not-helpful ratio. Keep the pure pipeline + single upsert shape. Tests for the new candidate.

---

## Final verification
- `npm run typecheck` clean
- `npm test` green
- Manual walkthrough per spec "Verification" §1–7
- Surface the two new migrations for the user to run.
