# Joined-Up Coach Memory — Design

**Date:** 2026-06-09
**Status:** Approved (design), pending implementation plan

## Problem

The athlete talks to the coach in several places — the Coach section (`/api/chat`), the
workout/session chat (`/api/chat/session`), the plan chat (`/api/chat/plan`), the coach
interview (`/api/chat/interview`), and the post-ride feedback thread (`/api/feedback/chat`).
Each surface has its own system-prompt builder and its own (or no) persistence:

- `/api/chat` persists both turns to `chat_messages`.
- `/api/feedback/chat` persists to `feedback_messages`, keyed by `feedback_id`.
- `/api/chat/session` does **not** persist at all — the client holds the history and it is lost
  when the modal closes.
- Plan chat and interview are likewise siloed or ephemeral.

No surface can see what was said in any other surface. The personas are worded almost
identically, so it is not a voice problem — it is a **memory** problem. The athlete says
something in the workout chat, opens the Coach section an hour later, and the coach has no idea
the conversation happened. It feels like talking to different people because each surface is a
different person with separate amnesia.

## Goal

1. Every coach conversation, on every surface, is written to **one shared log** so the coach has
   a single memory of what has been discussed.
2. Each surface **injects recent cross-surface conversation** into its prompt, so the coach
   picks up threads started elsewhere ("you mentioned your knee on Tuesday's ride…").
3. A nightly **conversation digest** distils long-running themes (open threads, recurring
   concerns, commitments) so the coach has continuity beyond the recent-transcript window
   without blowing the token budget.
4. A **shared persona + context head** so all five builders open identically — the memory block
   and dossier are injected the same way everywhere, and only the surface-specific task context
   differs.

All of this is **additive and fail-safe**: every new read is best-effort and returns empty on
error, so no surface can be broken by the memory layer.

## Non-goals (v1)

- Editing or deleting individual messages — the log is append-only.
- Real-time cross-surface sync within a single open session (memory is loaded at prompt-build
  time; a message sent in one open tab does not live-update another open tab).
- Re-deriving physiology, compliance, or load history in the digest — that is the dossier's job.
  The conversation memory is strictly about *what was discussed*, not *how training is going*.
- Net-new scheduling — digest synthesis rides on the existing nightly cron alongside
  dossier/belief synthesis, so it is eventually-consistent.
- Migrating away from `feedback_messages` as the feedback-thread store of record beyond the
  one-time backfill copy (the feedback thread keeps working as it does today; see Edge cases).

## Existing infrastructure this builds on

- **`chat_messages`** — global coach-chat log (`user_id, role, content, created_at`); the
  pattern the unified log generalises.
- **`feedback_messages`** — per-feedback thread (`feedback_id, user_id, role, content,
  created_at`); becomes one surface (`'feedback'`) of the unified log.
- **Chat builders** — `lib/claude/chat.ts` (`buildChatSystemPrompt`), `lib/claude/session-chat.ts`
  (`buildSessionSystemPrompt`), `lib/claude/feedback-chat.ts`
  (`buildFeedbackChatSystemPrompt`), `lib/claude/interview.ts`, and the plan-chat builder. All
  already inject the dossier section via a shared parameter.
- **Dossier** (`lib/claude/dossier.ts`: `formatDossier`, `AthleteDossier`) — already the shared
  longitudinal-context block injected across surfaces; the model for how a shared block is
  threaded into every builder.
- **Nightly synthesis cron** — already runs `synthesize-dossier` and `synthesize-beliefs`; the
  natural host for digest synthesis.
- **`MODEL`** from `lib/claude/client` (`claude-opus-4-8`) — used by all coaching tasks.
- **RLS own-data pattern** — `athlete_beliefs` / `feedback_messages` own-data policy is the
  template for the new tables.
- **Idempotent migration style** — `create table if not exists`, `add column if not exists`.

## Design

### Data model

New table **`coach_messages`** — the single append-only log across all surfaces:

| column       | type        | notes                                                       |
|--------------|-------------|-------------------------------------------------------------|
| `id`         | uuid pk     | `default gen_random_uuid()`                                 |
| `user_id`    | uuid        | references `auth.users(id)` on delete cascade               |
| `surface`    | text        | check in (`'coach'`,`'plan'`,`'workout'`,`'feedback'`,`'interview'`) |
| `role`       | text        | check in (`'user'`,`'assistant'`)                           |
| `content`    | text        | message body                                                |
| `context`    | jsonb null  | `{ workout_id?, plan_id?, feedback_id? }` — thread anchor   |
| `created_at` | timestamptz | `default now()`                                             |

- Index `(user_id, created_at desc)` — drives the recent-transcript read.
- Partial/secondary index supporting per-thread lookups by the `context` anchor (e.g. all
  messages for a given `workout_id` / `feedback_id`).
- Own-data RLS policy mirroring `athlete_beliefs`.

New table **`coach_conversation_memory`** — the nightly digest (one row per user):

| column           | type        | notes                                        |
|------------------|-------------|----------------------------------------------|
| `user_id`        | uuid pk     | references `auth.users(id)` on delete cascade |
| `digest`         | text        | prose summary injected into prompts          |
| `open_threads`   | jsonb       | structured: unresolved topics                |
| `recurring_concerns` | jsonb   | structured: themes raised repeatedly         |
| `commitments`    | jsonb       | structured: things the coach/athlete agreed  |
| `synthesized_at` | timestamptz | `default now()`                              |

- Own-data RLS policy.
- Upserted by the nightly job (one row per user, replaced each run).

**One-time idempotent backfill** (in the same migration set):

- Copy `chat_messages` → `coach_messages` with `surface = 'coach'`, `context = null`.
- Copy `feedback_messages` → `coach_messages` with `surface = 'feedback'`,
  `context = jsonb_build_object('feedback_id', feedback_id)`.
- Guarded so re-running the migration does not duplicate rows (e.g. insert-select with a
  `not exists` / `on conflict` guard, or a one-shot marker). The source tables are left intact.

### Memory loader — `lib/claude/coach-memory.ts`

`loadCoachMemory(supabase, userId, { surface, liveThreadIds }): Promise<string>`

Best-effort: wrapped so any failure returns `''` and the caller proceeds with no memory block.
Returns a single string with up to two labelled parts:

1. **RECENT CONVERSATIONS (across all your coaching)** — the last ~7 days / ~25 turns from
   `coach_messages`, ordered oldest→newest. Each turn is labelled with its surface, a relative
   day ("yesterday", "3 days ago"), and brief context (e.g. the workout type for `'workout'`
   turns). Turns belonging to the **live thread currently being served** are excluded via
   `liveThreadIds` so the model does not see the same messages twice (once as memory, once as
   the actual conversation history the route already passes).
2. **CONVERSATION MEMORY** — the digest text from `coach_conversation_memory.digest` (plus a
   compact rendering of `open_threads` / `commitments` where useful), giving continuity beyond
   the 7-day transcript window.

The whole block is capped to a token budget (recent transcript trimmed oldest-first if needed)
so it never crowds out the dossier or task context.

`liveThreadIds` is the set of message identifiers (or the thread anchor) the calling route is
already supplying as conversation history — for `/api/chat` that is the global coach thread, for
`/api/feedback/chat` it is the `feedback_id` thread, etc. The loader uses it purely to dedupe.

### Shared persona + context head — `lib/claude/coach-memory.ts`

To make every surface open identically:

- `COACH_PERSONA` — the single shared persona constant (the "expert road cycling coach
  messaging your athlete directly, plain prose, concise" voice), replacing the near-duplicate
  persona strings currently inlined in each builder.
- `buildCoachContext(memoryBlock, dossierSection): string` — assembles the common prompt head so
  every builder produces:

  ```
  [COACH_PERSONA]
  [memory block: RECENT CONVERSATIONS + CONVERSATION MEMORY]
  [dossier section]
  [surface-specific context]   ← each builder appends this
  [task instructions]          ← each builder appends this
  ```

  The first three lines are byte-identical across all five surfaces; only the surface-specific
  context and task instructions differ. This is what makes the coach feel like one person.

### Digest synthesis — `lib/claude/synthesize-conversation-memory.ts`

`synthesizeConversationMemory(supabase, userId, now): Promise<void>`

- Run by the nightly cron alongside dossier/belief synthesis. Model `claude-opus-4-8` (add a row
  to the CLAUDE.md model table: "Conversation memory synthesis
  (`lib/claude/synthesize-conversation-memory.ts`) | `claude-opus-4-8`").
- **Input:** the last ~90 days of `coach_messages` for the user, capped at ~400 turns
  (trimmed oldest-first beyond the cap).
- **Output:** structured JSON — `open_threads`, `recurring_concerns`, `commitments`, and a prose
  `digest` — upserted to `coach_conversation_memory`.
- **Scope guard:** the prompt explicitly instructs the model to capture *what has been discussed*
  (topics, questions left hanging, things agreed) and **not** to re-derive physiology, load, or
  compliance — that is the dossier's responsibility. This keeps the two synthesis outputs
  complementary rather than overlapping.

### Surface wiring

Each surface (a) writes both turns to `coach_messages` with the right `surface` + `context`, and
(b) injects the memory block via the shared head. The workout/session and plan/interview surfaces
that currently do not persist begin persisting.

| Surface   | Route                   | Builder                      | `surface`    | `context`            |
|-----------|-------------------------|------------------------------|--------------|----------------------|
| Coach     | `/api/chat`             | `buildChatSystemPrompt`      | `'coach'`    | `{}` / `null`        |
| Workout   | `/api/chat/session`     | `buildSessionSystemPrompt`   | `'workout'`  | `{ workout_id }`     |
| Plan      | `/api/chat/plan`        | plan-chat builder            | `'plan'`     | `{ plan_id }`        |
| Interview | `/api/chat/interview`   | `interview.ts`               | `'interview'`| `{}` / `null`        |
| Feedback  | `/api/feedback/chat`    | `buildFeedbackChatSystemPrompt` | `'feedback'` | `{ feedback_id }` |

- Persistence mirrors the `/api/chat` pattern: persist the user turn before streaming, persist
  the assistant turn after the stream completes. For surfaces that already persist to a legacy
  table (`/api/chat` → `chat_messages`, `/api/feedback/chat` → `feedback_messages`), write to
  `coach_messages` as the unified log; see Edge cases for the dual-write decision.
- `components/FeedbackChat.tsx` is repointed to read the `'feedback'` slice of `coach_messages`
  for the given `feedback_id` (via the `context` anchor) instead of `feedback_messages`.

### Types (`types/index.ts`)

- `CoachMessage { id; user_id; surface: 'coach'|'plan'|'workout'|'feedback'|'interview';
  role: 'user'|'assistant'; content; context: { workout_id?: string; plan_id?: string;
  feedback_id?: string } | null; created_at }`.
- `CoachConversationMemory { user_id; digest; open_threads; recurring_concerns; commitments;
  synthesized_at }`.

## Edge cases

- **Loader failure** (DB error, missing digest): `loadCoachMemory` returns `''`; the surface
  builds its prompt with no memory block and works exactly as today.
- **No digest yet** (new user, cron has not run): the RECENT CONVERSATIONS part still renders;
  the CONVERSATION MEMORY part is simply omitted.
- **Dedup against the live thread**: a surface already passes its own thread as history;
  `liveThreadIds` ensures those turns are not also rendered in the memory block.
- **Legacy `feedback_messages` / `chat_messages`**: backfilled once into `coach_messages`. To
  avoid a flag-day cutover, the feedback and coach routes **dual-write** (legacy table +
  `coach_messages`) during the transition, while all reads move to `coach_messages`. This is the
  chosen approach for v1 — it keeps the legacy tables valid as a fallback if a read regression
  appears. A later cleanup migration drops the dual-write and the legacy tables once nothing
  reads them.
- **Token pressure**: the memory block is trimmed oldest-first to its budget before the dossier
  and task context are appended, so memory never starves the rest of the prompt.
- **Surface with no anchor** (`'coach'`, `'interview'`): `context` is `null`; these still appear
  in the cross-surface recent transcript.
- **Digest scope drift**: if the digest starts echoing load/compliance, that is a prompt bug, not
  a data bug — the scope guard in the synthesis prompt is the control.

## Phasing

One spec; the implementation plan is sequenced in two phases so Phase 1 is independently
shippable and delivers the immediate "it remembers" win.

- **Phase 1 — unified log + recent transcript + shared persona:** `coach_messages` table +
  backfill + types; `loadCoachMemory` (RECENT CONVERSATIONS only) + `COACH_PERSONA` +
  `buildCoachContext`; wire all five surfaces to write to `coach_messages` and inject the recent
  transcript; repoint `FeedbackChat`. This alone makes the coach feel joined-up.
- **Phase 2 — nightly digest:** `coach_conversation_memory` table;
  `synthesize-conversation-memory`; add it to the nightly cron; extend `loadCoachMemory` to
  append the CONVERSATION MEMORY part.

## Verification

1. Say something distinctive in the workout chat, then open the Coach section → the coach
   references it ("you mentioned … on your ride").
2. Across surfaces, the coach's opening voice is identical (shared persona) — no surface reads as
   a different persona.
3. Every surface's turns appear in `coach_messages` with the correct `surface` and `context`
   anchor; workout and plan chats now persist (previously ephemeral).
4. The live thread is not double-rendered — a message shows once as history, not also in the
   memory block.
5. Force `loadCoachMemory` to throw → every surface still builds its prompt and responds; no
   error surfaced.
6. After a nightly run, `coach_conversation_memory` holds a digest scoped to *discussion topics*
   (open threads, recurring concerns, commitments) and free of load/compliance restatement; the
   CONVERSATION MEMORY block appears in subsequent prompts.
7. Reopen a completed workout's feedback thread → it loads from the `'feedback'` slice of
   `coach_messages` and matches what was previously in `feedback_messages`.
