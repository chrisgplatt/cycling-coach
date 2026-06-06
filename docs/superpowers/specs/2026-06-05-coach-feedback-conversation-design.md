# Coach's Post-Ride Note → Feedback Conversation — Design

**Date:** 2026-06-05
**Status:** Approved (design), pending implementation plan

## Problem

When an athlete logs post-ride feedback, the coach currently says nothing back unless the
"Suggest adaptations" toggle is on — and even then, the only coach narrative is
`proposed_adjustment.summary`, which is change-oriented (what to alter in upcoming workouts)
rather than an assessment of the session just completed. If the athlete logs feedback
*without* asking for adaptations (`shouldAdapt === false`), nothing is stored beyond their raw
text and structured signals.

There is **no persistent coach's-side record** of how a session went, and **no way to discuss
it**. The athlete cannot push back on the coach's read, cannot signal whether the coaching was
useful, and none of that conversational nuance reaches the dossier or the athlete-response
(belief) model that shapes future coaching.

## Goal

1. Every feedback submit generates a short (2–3 sentence) coach assessment of the session,
   saved against the workout, **independent of the adapt toggle**.
2. The athlete can rate how useful that note was and reply in a two-way thread anchored to the
   feedback entry.
3. The conversation feeds the **dossier** (longitudinal athlete context) and the usefulness
   signal feeds the **belief synthesis** (athlete-response model — *how to coach this person*),
   so future sessions and feedback improve.

## Non-goals (v1)

- Editing or deleting individual thread messages — the thread is append-only.
- Push notifications or any real-time delivery beyond the in-app thread.
- Feeding the coach note into the coaching-log list view (it keeps using
  `proposed_adjustment.summary`).
- Net-new scheduling — synthesis stays on the existing nightly cron, so dossier/belief updates
  are eventually-consistent.

## Existing infrastructure this builds on

- **`session_feedback`** table — post-ride record: `feedback_text`, `rpe`, `feel`,
  `completion`, `tags`, `mood`, `proposed_adjustment`, `approved`. Linked to a workout by
  `workout_id`. A fresh row is inserted on every submit (edit & re-submit ⇒ new row).
- **Feedback API** (`app/api/feedback/route.ts`): `POST` inserts feedback and conditionally runs
  `analyseFeedback` (only when `shouldAdapt`); `GET?workoutId=` returns the latest feedback row
  for a workout (`select('*')`); `PATCH` currently handles the `approved` apply/reject path.
- **Streaming chat pattern**: `/api/chat` persists both turns to the global `chat_messages`
  table (`user_id, role, content, created_at`) and streams the reply; `/api/chat/session`
  follows the same streaming shape but does **not** persist (client holds history). Models use
  `MODEL` from `lib/claude/client` (`claude-opus-4-8`).
- **Dossier synthesis** (`lib/claude/synthesize-dossier.ts`): nightly, reads `workouts`,
  `session_feedback` (text/rpe/feel/completion/tags), and the last ~100 `chat_messages`, then
  upserts `athlete_dossier`.
- **Belief synthesis** (`lib/claude/synthesize-beliefs.ts`): the athlete-response model — the
  natural home for a "how well is the coaching landing" signal.
- **`activity-metrics`** helpers: `formatRideExecution(steps, activity_metrics)` and
  `formatRideShape(shape)` already produce the ride-execution prose used by `analyseFeedback`.
- **RLS pattern**: `athlete_beliefs` migration's own-data policy is the template for the new
  table.

## Design

### Data model

Two columns on `session_feedback`:

- `coach_note text` — the canonical assessment. Single source for the quick "Coach's take"
  display; rendered as the first assistant bubble when the thread is opened.
- `coach_note_rating text` — `'helpful' | 'not_helpful' | null`. One value per note.

New table **`feedback_messages`** — the conversation only (NOT the coach note, which lives on
`session_feedback.coach_note` to avoid a duplicate source of truth):

| column      | type        | notes                                            |
|-------------|-------------|--------------------------------------------------|
| `id`        | uuid pk     | `default gen_random_uuid()`                      |
| `feedback_id` | uuid      | references `session_feedback(id)` on delete cascade |
| `user_id`   | uuid        | references `auth.users(id)`                       |
| `role`      | text        | `'user' | 'assistant'`                           |
| `content`   | text        | message body                                     |
| `created_at`| timestamptz | `default now()`                                  |

- Own-data RLS policy mirroring `athlete_beliefs`.
- Index on `(feedback_id, created_at)` for ordered thread reads.
- Migrations are idempotent (`create table if not exists`, `add column if not exists`),
  matching the existing migration style.

### Generation — `lib/claude/session-note.ts`

`assessSession(workout, feedbackText, signals, rideExecution): Promise<string>`

- Model `claude-opus-4-8` (add a row to the CLAUDE.md model table:
  "Post-session coach note (`lib/claude/session-note.ts`) | `claude-opus-4-8`").
- Returns 2–3 sentence plain-voice prose assessing the session — weaving in the structured
  signals (RPE, feel, completion, tags, mood) and how the ride was actually executed.
- Context is deliberately lean: the workout (type/duration/description/target/steps), the
  athlete's `feedback_text`, the structured signals, and the ride-execution prose
  (`formatRideExecution` + `formatRideShape`). It does **not** pull upcoming workouts, events,
  or the dossier — this assesses the session done, it does not propose load changes, so the
  full athlete-state block required for load/intensity changes does not apply.

### Conversation — `/api/feedback/chat` POST

`{ feedbackId, message, history }` → streams the coach's reply (same streaming shape as
`/api/chat`), then persists the user turn and the assistant turn to `feedback_messages`.

- System prompt: the same session context as `assessSession` (workout + feedback + signals +
  ride execution) **plus** the coach note and the running thread, so the coach can defend or
  revise its read and respond to "was that useful" pushback.
- Auth + ownership: verify the `feedback_id` belongs to the user before responding.
- Persist user message before streaming; persist assistant message after the stream completes
  (mirrors `/api/chat`).

### API wiring — `app/api/feedback/route.ts`

- **POST**: lift the `rideExecution` build out of the `if (shouldAdapt)` block so it is always
  available (it only needs the workout). Always call `assessSession`; when adapting, run it in
  parallel with `analyseFeedback`. Best-effort: wrap `assessSession` in try/catch — on failure
  `coach_note = null` and the submit still succeeds (same resilience as the intervals.icu feel
  write-back). Add `coach_note` to the insert and return it in the response.
- **PATCH**: extend to accept `{ feedbackId, coachNoteRating }` as a distinct branch alongside
  the existing `{ feedbackId, approved }` path — sets `coach_note_rating` and returns `ok`.

### Synthesis wiring

- **Dossier** (`synthesize-dossier.ts`): add a read of `feedback_messages` for the user (joined
  to / grouped by feedback within the 90-day window) and thread the conversations into
  `generateDossier` as an additional longitudinal source, the way `chat_messages` already is.
- **Beliefs** (`synthesize-beliefs.ts`): feed `coach_note_rating` plus the conversation as a
  coaching-calibration signal — evidence about how well the coaching is landing — used to tune
  the tone/content of future notes and feedback.

### UI

- **`components/WorkoutDetailModal.tsx`** "Session feedback" block: show the coach note
  ("Coach's take"), the 👍 helpful / 👎 not-helpful rating control, and an expandable
  conversation thread. `GET?workoutId=` already does `select('*')`, so `coach_note` and
  `coach_note_rating` arrive for free; thread messages load lazily when expanded.
- **`components/FeedbackModal.tsx`** saved phase: show the coach's take + rating control + entry
  into the thread immediately after submit.
- New **`components/FeedbackChat.tsx`** — mobile-first thread + input (≥44px touch targets,
  bottom-sheet-friendly), following AGENTS.md. Renders `coach_note` as the opening assistant
  bubble, then `feedback_messages`.

### Types (`types/index.ts`)

- `SessionFeedback`: add `coach_note: string | null`, `coach_note_rating: 'helpful' |
  'not_helpful' | null`.
- Add `FeedbackMessage { id; feedback_id; role: 'user' | 'assistant'; content; created_at }`.

## Edge cases

- **Log-only feedback** (adapt off): now produces a coach note — the core gap being closed.
- **Edit & re-submit**: a fresh `session_feedback` row is inserted (existing behaviour), so a
  new note regenerates; the old thread stays attached to the old row.
- **Manual entries** (no linked activity / no execution metrics): note generated from feedback
  + signals, just without ride-execution prose.
- **`assessSession` failure**: `coach_note = null`, submit succeeds; the UI shows the existing
  feedback without a coach's-take block.
- **Chat before a note exists** (assessSession failed): thread opens with no opening bubble; the
  coach still has the session context to respond.

## Phasing

One spec; the implementation plan is sequenced in two parts so Phase A is independently
shippable.

- **Phase A — the note:** `coach_note` column + type; `assessSession`; POST wiring; display the
  coach's take in `WorkoutDetailModal` and `FeedbackModal` saved phase.
- **Phase B — the conversation:** `feedback_messages` table + `coach_note_rating` column;
  `/api/feedback/chat`; `FeedbackChat` component; rating control + PATCH wiring; dossier +
  belief synthesis wiring.

## Verification

1. Log feedback with adapt OFF → a coach's take appears and persists against the workout.
2. Log feedback with adapt ON → coach's take AND the adaptation proposal both appear; the note
   is session-oriented, distinct from the change-oriented proposal.
3. Reopen the completed workout → the coach's take shows in the "Session feedback" card.
4. Rate the note 👍/👎 → `coach_note_rating` persists and survives reopen.
5. Reply in the thread → the coach responds in the athlete's coaching voice with session
   context; both turns persist and reload.
6. `assessSession` forced to throw → submit still succeeds, no coach's-take block, no error
   surfaced to the athlete.
7. After a nightly synthesis run, the dossier reflects feedback-conversation context and the
   belief model reflects the usefulness signal.
