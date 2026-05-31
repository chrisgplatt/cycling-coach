# Coach Interview for Plan Generation — Design

**Date:** 2026-05-31
**Status:** Approved (design); pending implementation plan

## Problem

When an athlete builds a new training plan, the only way to give the coach
context is a single free-text "Anything else to consider?" box in
`PlanDurationModal`. Many athletes won't think to mention the things that most
shape a good plan — a niggling injury, a stressful work month, a session type
they dread, how their body has actually felt lately. We want to offer an
**optional, coach-led interview** that draws this context out conversationally,
ideally hands-free via voice, and feeds it into plan generation — and into the
athlete's durable profile for future use.

## Goals

- Offer an optional interview as a step in the existing "Build New Plan" flow.
- Coach leads a **hybrid** conversation: a fixed backbone of core topics, with
  targeted adaptive follow-ups when an answer warrants one.
- Support **voice-to-text** input, with a graceful fallback to typing.
- Distil the conversation into (a) a coaching brief that shapes *this* plan and
  (b) durable facts saved to the athlete dossier for future plans, reviews, and
  coach chat.

## Non-Goals

- No persistence of an in-progress interview. Closing mid-interview discards it.
- No server-side transcription (Whisper etc.) in v1 — native browser speech only,
  with a typed fallback. Server transcription can be added later if iOS proves
  unreliable.
- No changes to the plan-generation algorithm itself — the interview only enriches
  the existing `notes` input and the dossier.
- Voice input is not wired into the existing `PlanChatModal` in v1 (the hook is
  built reusable so it can be later).

## User Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Interview style | **Hybrid** — fixed backbone + targeted adaptive follow-ups |
| Output | **Distil + save to dossier** — brief for this plan AND durable facts persisted |
| Voice | **Native Web Speech API with graceful fallback** to typing |
| Placement | **Step before the duration modal** in the Build New Plan flow |

## Flow & UX

The "Build New Plan" journey gains an optional interview step before the duration
modal:

```
Build New Plan ─▶ [Replace-plan confirm, if a plan exists]
                      │
                      ▼
            ┌──────────────────────────────┐
            │  "Chat with your coach first  │
            │   so I can tailor the plan?"  │
            │   [ Skip ]   [ Start chat ]   │
            └──────────────────────────────┘
                 │                  │
              Skip│                 │Start
                 │                  ▼
                 │          InterviewModal (chat + 🎤)
                 │          coach asks → you answer →
                 │          coach wraps up
                 │                  │ distils
                 │                  ▼
                 │      • durable facts saved to dossier
                 │      • brief pre-fills the notes box
                 ▼                  ▼
            PlanDurationModal (start date / weeks / notes)
                      ▼
                 Generate plan  (unchanged)
```

- The interview is **fully optional** — Skip preserves today's exact behaviour
  (the duration modal opens with empty notes).
- It is **ephemeral**: the in-progress conversation lives in component state only.
  Nothing is persisted until the interview completes.
- On completion, `PlanDurationModal` opens with `initialNotes` pre-filled from the
  brief (the page already wires `planGenNote` → `initialNotes`). The user can edit
  the notes before generating.

## Architecture

The interview is **model-orchestrated**, mirroring the proven `PlanChatModal` +
`__PLAN_PROPOSAL__` pattern rather than coding a client/server state machine. The
"fixed backbone" is enforced through the system prompt; Claude (Opus) manages the
hybrid flow and decides when to wrap up.

### New: `lib/claude/interview.ts` (pure, no React/DOM)

- `buildInterviewSystemPrompt(profile, wellness, currentFTP, dossierSection)` →
  string. Assembles athlete context the same way `app/api/chat/plan/route.ts`
  does (goals, FTP, zones, weekly schedule, upcoming events, current fitness,
  existing dossier), then appends:
  - **Backbone topics**, walked in order, one question per turn:
    1. Goal / what they want from this block
    2. How training and the body have felt recently (fatigue, motivation)
    3. Injuries, niggles, health constraints
    4. Life load — work, sleep, stress, time pressure in the coming weeks
    5. Session likes/dislikes (indoor/outdoor, where they want to push)
    6. Anything else / specific worries about the block
  - **Hybrid rule:** ask one question at a time; when an answer reveals an injury,
    a rough patch, or a constraint, ask *up to one* focused follow-up before moving
    on. Personalise the opener using known context (goals, target event).
  - **Exit rule:** when all core topics are covered, OR the athlete asks to finish,
    emit a short visible sign-off, then on a new line `__INTERVIEW_COMPLETE__`
    followed by a JSON block (schema below). No markdown, plain prose only.
- `parseInterviewCompletion(fullText)` →
  `{ visible: string; plan_brief?: string; dossier_notes?: string[] }`.
  Dependency-free, mirrors `extractNoteMarker` in `PlanChatModal`. Splits on the
  `__INTERVIEW_COMPLETE__` marker, parses the trailing JSON, and tolerates a
  missing/malformed block (returns `visible` only).

Completion JSON schema (emitted in the same assistant turn, exactly like
`__PLAN_PROPOSAL__`):

```json
{
  "plan_brief": "one tight coaching paragraph for THIS plan",
  "dossier_notes": ["Left knee niggles on climbs >20min", "Prefers long weekend rides"]
}
```

### New: `app/api/chat/interview/route.ts`

- `POST` — body `{ message, history, wellness, currentFTP }`.
- Unlike `/api/chat/plan`, an **empty `message` is allowed** for the opening turn
  (the seed request): when `message`/`history` are empty, a single synthetic user
  turn ("Let's begin.") seeds the model so it streams its greeting + first
  question.
- Auth + fetch `user_profile` and dossier server-side (same as
  `/api/chat/plan`). Build the system prompt with `buildInterviewSystemPrompt`.
- Stream the assistant reply as `text/plain` using
  `anthropic.messages.stream({ model: 'claude-opus-4-8', max_tokens: 2048, ... })`,
  identical streaming shape to `/api/chat/plan`.
- The route does **not** itself parse the completion block — the client does, then
  drives persistence. This keeps the route a thin streaming endpoint.

### New: `components/InterviewModal.tsx`

- Chat UI reusing `PlanChatModal`'s visual language (header, message bubbles,
  rounded input bar, `max-h-[85vh]`, `items-end sm:items-center` mobile sheet
  behaviour per AGENTS.md).
- Props: `{ profileContext for the opener (planName/targetEvent optional),
  wellness, currentFTP, onComplete(brief: string), onClose }`.
- On open, the modal fires one request with an empty/seed message so the coach
  streams a **personalised greeting + the first backbone question** (no static
  opener — keeps the conversation fully model-orchestrated). A "Coach is
  preparing…" placeholder shows until the first tokens arrive.
- On each send, streams the reply; strips everything from `__INTERVIEW_COMPLETE__`
  onward from the visible bubble (same cut-marker technique as `PlanChatModal`).
- When `parseInterviewCompletion` yields a completion:
  - POST each `dossier_notes[i]` to `POST /api/dossier/notes` as `{ note }`
    (fire-and-forget, `.catch` ignored — matches existing `postNote`).
  - call `onComplete(plan_brief ?? '')`, which closes the modal and opens
    `PlanDurationModal` with the brief pre-filled.
- A **"Finish now"** affordance lets the athlete end early; it simply sends a
  message like "That's everything — build my plan", which the prompt's exit rule
  turns into a completion.

### New: `lib/hooks/useVoiceInput.ts`

- Thin React hook over `window.SpeechRecognition || window.webkitSpeechRecognition`.
- Returns `{ supported, listening, start, stop }`. `start(onText)` streams interim
  + final transcripts to a callback the modal appends to the input box.
- `supported` is `false` when the constructor is missing → the modal hides the mic
  button entirely. Any recognition error (permission denied, `no-speech`) stops
  listening silently; the text box remains fully usable. Cleans up on unmount.

### Changed: `app/plan/page.tsx`

- New state `showInterviewOffer: boolean` (and reuse existing `planGenNote`).
- The two "Build New Plan" entry points that currently call
  `setShowDurationPrompt(true)` instead set `setShowInterviewOffer(true)`:
  - the no-plan empty-state button (currently `setShowDurationPrompt(true)` when
    `events.length > 0`), and
  - the replace-confirm "Continue" button (currently
    `setShowReplaceConfirm(false); setShowDurationPrompt(true)`).
- Render the offer (a small modal, same style as the replace-confirm dialog):
  - **Skip** → `setShowInterviewOffer(false); setShowDurationPrompt(true)`
    (notes stay empty — today's behaviour).
  - **Start chat** → `setShowInterviewOffer(false)`, open `InterviewModal`.
- `InterviewModal.onComplete(brief)` → `setPlanGenNote(brief)` then
  `setShowDurationPrompt(true)`. Dossier notes are already saved by the modal.

### Changed: `CLAUDE.md`

- Add a row to the Model Selection table:
  `| Coach interview (`/api/chat/interview`) | `claude-opus-4-8` |`.

## Data Flow Summary

```
InterviewModal ──POST /api/chat/interview──▶ Claude (opus-4-8, streamed)
      │  fullText incl. __INTERVIEW_COMPLETE__ + JSON
      ▼
parseInterviewCompletion(fullText)
      ├─ dossier_notes[] ──POST /api/dossier/notes {note}──▶ athlete_dossier.explicit_notes
      └─ plan_brief ──onComplete()──▶ planGenNote ──▶ PlanDurationModal notes ──▶ POST /api/plan
```

## Error Handling

| Failure | Behaviour |
|---------|-----------|
| Interview route error / non-OK | Assistant bubble "Something went wrong — try again." (as `PlanChatModal`) |
| Completion JSON missing/malformed | `parseInterviewCompletion` returns `visible` only; proceed to duration modal with empty notes; skip dossier saves; log to console |
| Dossier note POST fails | Ignored (`.catch`) — non-blocking, brief still flows to the plan |
| Speech API absent | Mic button not rendered; typed input only |
| Speech permission denied / `no-speech` / other error | Stop listening silently; text box stays usable |

## Testing

- Unit tests for `parseInterviewCompletion`: clean parse; marker present but JSON
  malformed; no marker at all; `dossier_notes` present with empty `plan_brief`;
  `plan_brief` present with no `dossier_notes`.
- Smoke test that `buildInterviewSystemPrompt` includes the six backbone topic
  cues and key athlete fields (goals, FTP, today's date, events section).
- `npm run build` remains the type-check gate (Jest via SWC does not type-check).
- Manual: run an interview end-to-end on a phone; confirm voice dictation on a
  supported browser, the typed fallback where unsupported, the brief pre-filling
  the notes box, and the durable notes appearing in the dossier.

## File Manifest

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/claude/interview.ts` | create | System-prompt builder + completion parser (pure) |
| `app/api/chat/interview/route.ts` | create | Thin streaming coach-interview endpoint |
| `components/InterviewModal.tsx` | create | Interview chat UI + voice + completion handling |
| `lib/hooks/useVoiceInput.ts` | create | Reusable Web Speech API hook with fallback |
| `app/plan/page.tsx` | modify | Offer step + wiring interview → duration modal |
| `CLAUDE.md` | modify | Add interview route to the model-selection table |
| `__tests__/lib/interview.test.ts` | create | Unit tests for the parser + prompt builder |
