# Coach Section & Athlete Chat — Design

**Date:** 2026-05-30
**Status:** Approved (pending spec review)

## Goal

Surface the athlete dossier — today an invisible AI-context object — as a dedicated top-level **Coach** section, and give the athlete a place to talk to their coach personally (how they're feeling, motivation, life stress) rather than about a specific workout or plan. The chat captures durable personal notes automatically and feeds them into the coach's notes.

## Background — what already exists

- **Dossier (`athlete_dossier` table):** structured `content` (`as_rider`, `strengths[]`, `weaknesses[]`, `training_compliance`, `recovery_profile`, `event_performance`, `trajectory`), plus `explicit_notes[]` (`{note, added_at}`) and `synthesized_at`. Regenerated nightly at 3am by `/api/cron/dossier` from 90 days of workouts, session feedback, event results, and the last 100 chat messages. Injected into AI prompts via `formatDossier()`. **Not displayed anywhere in the UI today.**
- **General chat (`/api/chat`):** already loads plan, fitness, events, and dossier as context; streams replies; persists to `chat_messages`. Supports `__REMEMBER__` / `__FORGET__` markers that write to `explicit_notes` via `/api/dossier/notes`.
- **`ChatPanel.tsx`:** implements that chat with marker handling, but is **commented out** in `app/layout.tsx` (currently disabled).
- **`/api/dossier` GET:** returns the dossier. **`/api/dossier/notes` POST:** adds (`note`) or removes (`forget`, fuzzy-matched) an explicit note.

This feature mostly *surfaces* and *re-activates* existing plumbing; the nightly synthesis, daily briefing, and session/plan chats are unchanged.

## Decisions (from brainstorming)

- "Coach's notes" = the **dossier** (not the daily briefing).
- Note capture from the personal chat is **automatic** — the coach decides what's worth remembering.
- Section layout is **notes-first**: dossier shown as a report, chat opened via a button below.
- Profile prose can be **manually refreshed** on demand, in addition to the nightly rebuild.

## Architecture

New route `/coach` (nav between Fitness and Account). The page fetches the dossier (`GET /api/dossier`) and renders it read-only, with a manual **Refresh** action and a **Chat** button that opens a full-screen conversation. The chat posts to the existing `/api/chat`; auto-captured notes land in `explicit_notes` and appear in the page's **Remember** list. A manual refresh and the nightly cron share one synthesis helper.

### Components & responsibilities

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `app/coach/page.tsx` | Fetch + render dossier report, Remember list (with delete), Refresh button, Chat launcher, empty state | `/api/dossier`, `/api/dossier/refresh`, `/api/dossier/notes`, `CoachChat` |
| `components/CoachChat.tsx` | Full-screen athlete chat; streams from `/api/chat`; strips note markers and posts them to `/api/dossier/notes` | `/api/chat`, `/api/dossier/notes` |
| `app/api/dossier/refresh/route.ts` | Authed `POST`; rebuild this user's dossier on demand via shared helper | `synthesizeDossier` |
| `lib/claude/dossier.ts` → `synthesizeDossier(supabase, profile)` | Gather 90d inputs, call `generateDossier`, upsert preserving `explicit_notes` | `generateDossier`, Supabase |

## Page layout (notes-first)

```
┌─────────────────────────────┐
│  Coach's notes      ↻ Refresh│   header + manual refresh, disabled while running
│  Updated 2 days ago          │   relative age of synthesized_at
├─────────────────────────────┤
│  As a rider          <prose> │
│  Strengths    · chip · chip  │
│  Watch        · chip · chip  │   weaknesses
│  Training compliance <prose> │
│  Recovery profile    <prose> │
│  Event performance   <prose> │
│  Trajectory          <prose> │
├─────────────────────────────┤
│  Remember                    │   explicit_notes, newest first
│   • Left knee flares… ✕      │
│   • Feeling burnt out… ✕     │
├─────────────────────────────┤
│  [ 💬 Chat with your coach → ]│   opens full-screen CoachChat
└─────────────────────────────┘
```

- Read-only report. Strengths/weaknesses render as chips; other fields as short prose blocks. **Empty fields are hidden.**
- **Remember** lists `explicit_notes` newest-first; each has a small ✕ that calls `POST /api/dossier/notes` with `{ forget: <note text> }`, then refetches.
- **Empty state** (no dossier or empty `content`): friendly message inviting the athlete to chat or hit Refresh.
- **Chat** opens a full-screen view (better mobile typing) rather than embedding a scrolling chat inside the scrolling page.
- Mobile-first per AGENTS.md: ≥320px, 44px touch targets, full-screen chat uses `max-h`/overflow handling already present in `ChatPanel`.

## Chat & automatic note capture

`CoachChat` is a refactor of `ChatPanel`: same streaming and `extractNoteMarker` → `postNote` logic, but presented as a full-screen view launched from the Coach page (no floating button, not mounted globally in layout).

System-prompt change in `app/api/chat/route.ts`: the coach may emit a `__REMEMBER__` marker **proactively**, not only on explicit request. Guardrails in the prompt:

- Capture **durable, personal** observations and **significant state changes**: persistent feelings (e.g. burnout, low motivation), physical constraints/niggles, sleep/stress patterns, scheduling limitations.
- **Skip** trivia, transient small talk, and one-off remarks.
- **Never** duplicate a note already present in the dossier context.
- Events still belong in the calendar and workout preferences in goals — not notes.
- One marker per reply (existing parser reads the first marker only).

Captured notes write to `explicit_notes` immediately (appear in **Remember** at once). Both the notes and the raw conversation flow into the structured profile at the next synthesis (synth already reads the last 100 chat messages + notes), so personal context also shapes `recovery_profile` and `trajectory`.

`__FORGET__` behaviour is unchanged.

## Manual refresh & shared synthesis

Extract the cron's inline gathering/synthesis into `synthesizeDossier(supabase, profile)` in `lib/claude/dossier.ts`:

1. Pull last-90-day completed/skipped workouts, session feedback, event results (events with `icu_activity_id`), and last 100 chat messages for the user.
2. Call `generateDossier(...)`.
3. Upsert `athlete_dossier` (`onConflict: user_id`) with new `content` and `synthesized_at`, **preserving existing `explicit_notes`**.
4. On failure, throw; caller leaves the existing dossier untouched.

Both callers use it:
- `app/api/cron/dossier/route.ts` — keeps its per-user timezone/3am gating and logging, but the gather+synthesize+upsert body becomes a call to `synthesizeDossier`.
- `app/api/dossier/refresh/route.ts` — authed `POST`; loads the caller's `user_profile`, calls `synthesizeDossier`, returns `{ ok: true }` or a 500 with the error.

The Refresh button disables while running (Opus call), then refetches the dossier. Failure shows an inline error and keeps the old notes on screen.

## Error handling

- Dossier fetch failure → page shows an error/empty state, not a crash.
- Refresh failure → inline error; existing dossier preserved (mirrors cron's leave-untouched behaviour).
- Chat stream error → existing `ChatPanel` error path retained.
- Note delete failure → silently no-ops the optimistic update / refetch (low stakes).

## Testing

- **`synthesizeDossier`** (unit): gathers the right inputs, calls `generateDossier`, upserts with new `content` + `synthesized_at`, **preserves `explicit_notes`**; throws on synth failure without wiping existing data.
- **`/api/dossier/refresh`** (route): rejects unauthenticated; success path calls the helper and returns ok; helper error → 500, dossier untouched.
- **Cron** still produces a dossier via the shared helper (existing cron test updated to the refactor).
- **`CoachChat`**: the refactored `ChatPanel.test.tsx` points at the new component — streaming render and marker stripping still pass.
- LLM capture *judgement* is not unit-testable; rely on explicit prompt guardrails.

## Out of scope / YAGNI

- No new note categories (transient vs durable) — one `explicit_notes` list.
- No auto-refresh after every chat (manual button + nightly only).
- No nav redesign, though the bar is getting full (Dashboard, Stats, Calendar, Plan, Fitness, Coach, Account) — flagged for a later pass.
- Session/plan chats and the daily briefing are untouched.
