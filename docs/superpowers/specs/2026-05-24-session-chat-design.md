# Session Chat Design

## Goal

Add a contextual coach chat to the daily briefing — a "Chat with coach →" link below the TodayCard briefing note that opens a bottom-sheet conversation pre-loaded with today's workout context. The coach can answer questions about the session and propose modifications; the user can approve them in-place.

## Architecture

Three new pieces layered on top of existing infrastructure:

1. **TodayCard** — a "Chat with coach →" link below the briefing note, visible when there is a planned or completed workout today.
2. **`SessionChatModal`** — a new bottom-sheet chat component (mobile-first, slides up from bottom). Ephemeral in-memory history, not persisted to `chat_messages`.
3. **`/api/chat/session`** — a new streaming endpoint with a workout-focused system prompt and structured proposal output.

The approve flow reuses `PATCH /api/workouts/[id]` — no new endpoints needed for applying changes.

---

## Data Flow

```
TodayCard
  └─ "Chat with coach →" link
       └─ opens SessionChatModal(workout, wellness, briefingText)
            └─ POST /api/chat/session { message, workoutId, history }
                 └─ streams text + optional __PROPOSAL__ block
                      └─ on approve → PATCH /api/workouts/[id]
```

---

## Types

Add to `types/index.ts`:

```ts
export interface SessionWorkoutUpdate {
  type?: WorkoutType
  duration_minutes?: number
  description?: string
  target_zones?: string
}

export interface SessionProposal {
  today_update: SessionWorkoutUpdate
  rationale: string
  week_follow_up?: string  // coach message to inject after approval offering week adjustments
}

export interface SessionWeekProposal {
  changes: WorkoutChange[]  // reuses existing WorkoutChange type
  rationale: string
}
```

---

## TodayCard Changes

- Add `onChatWithCoach?: () => void` prop.
- Render a `"Chat with coach →"` link below the briefing note when:
  - `workout` is not null (i.e. there is a session today), AND
  - `onChatWithCoach` is provided.
- The link is `text-xs font-medium text-blue-600 hover:text-blue-700`.

---

## SessionChatModal

**Props:**
```ts
interface Props {
  workout: Workout
  wellness: ICUWellness | null
  briefingText: string | null
  onClose: () => void
  onWorkoutUpdated: (updated: Workout) => void
}
```

**State:**
```ts
type Phase = 'chat' | 'proposing' | 'week_proposing'

const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
const [input, setInput] = useState('')
const [loading, setLoading] = useState(false)
const [proposal, setProposal] = useState<SessionProposal | null>(null)
const [weekProposal, setWeekProposal] = useState<SessionWeekProposal | null>(null)
const [phase, setPhase] = useState<Phase>('chat')
```

**Opening greeting:** On mount, render a static opening message assembled from props — no API call needed:
```
"You've got a {duration}min {type} session today. {readiness} ({tsb} TSB). What's on your mind?"
```

**Streaming:** Same pattern as existing ChatPanel — reads from `res.body` with `TextDecoder`, appends chunks to the last assistant message.

**Proposal detection:** After the stream closes, check if the full response contains `\n__PROPOSAL__\n`. If so:
- Split on the delimiter
- Render the text part as the chat bubble
- Parse the JSON as `SessionProposal`
- Set `proposal` state and `phase = 'proposing'`
- Render an inline proposal card below the message

**Proposal card UI:**
```
┌─────────────────────────────────────────┐
│ Proposed changes                         │
│ Duration: 60 min → 40 min               │
│ {rationale}                             │
│                          [Reject] [Approve] │
└─────────────────────────────────────────┘
```

**On approve:**
1. PATCH `/api/workouts/[id]` with `proposal.today_update`
2. Call `onWorkoutUpdated` with the updated workout
3. Clear `proposal`, set `phase = 'chat'`
4. If `proposal.week_follow_up` exists, inject it as the next assistant message automatically
5. Re-enable input

**On reject:**
1. Clear `proposal`, set `phase = 'chat'`
2. Inject `"No problem — let me know if you'd like to try a different approach."` as assistant message

**Week proposal flow:**
After the week_follow_up message is injected, the user replies conversationally. If they say yes, the next API response may contain a `\n__WEEK_PROPOSAL__\n` block (a `SessionWeekProposal`). The frontend renders each `WorkoutChange` as a row in a proposal card. Approving fires `PATCH /api/workouts/[id]` for each change in sequence.

**Layout (mobile-first):**
```
Fixed overlay: inset-0, z-50, bg-black/40
Sheet: fixed bottom-0 left-0 right-0, max-h-[85vh], rounded-t-2xl, bg-white, flex flex-col
Header: workout title + "×" close button
Messages: flex-1 overflow-y-auto, space-y-2
Input bar: sticky bottom-0, border-t
```

---

## `/api/chat/session` Endpoint

**Request:**
```ts
{ message: string; workoutId: string; wellness: ICUWellness | null; history: { role: 'user' | 'assistant'; content: string }[] }
```

**Server actions:**
1. Auth check.
2. Fetch workout by `workoutId` (must belong to user).
3. Fetch active training plan.
4. Fetch upcoming workouts (next 7 days).
5. Use wellness passed as part of the request body (the dashboard already holds synced wellness — no server-side ICU call needed).
6. Build system prompt (see below).
7. Stream response via Anthropic SDK, same pattern as `/api/chat`.

**System prompt structure:**
```
You are an expert road cycling coach. Be direct and practical.

TODAY'S SESSION ({date}):
Type: {type} | Duration: {duration_minutes} min
Description: {description}
Target zones: {target_zones}

ATHLETE STATE:
CTL: {ctl} | ATL: {atl} | Form: {tsb} | HRV: {hrv}
FTP: {ftp}W

TRAINING PLAN: {plan name, phase, target event}

NEXT 7 DAYS:
{list of upcoming workouts}

Answer questions about today's session. If the athlete asks to modify or rework the session,
propose specific changes. When proposing changes, end your response with:

__PROPOSAL__
{"today_update": {...}, "rationale": "...", "week_follow_up": "..."}

Only include week_follow_up if the modification meaningfully affects weekly load.
The week_follow_up should be a single coaching question asking if they want to adjust the week.

If the athlete asks to adjust the week, propose specific changes and end your response with:

__WEEK_PROPOSAL__
{"changes": [...], "rationale": "..."}

Each change: {"workout_id": "...", "field": "duration_minutes|description|type", "old_value": ..., "new_value": ..., "reason": "..."}
```

**Streaming:** Same `ReadableStream` + `TextEncoder` pattern as `/api/chat`. The `__PROPOSAL__` block is part of the streamed text — the frontend buffers and parses after stream close.

---

## Dashboard Wiring (`app/dashboard/page.tsx`)

- Pass `onChatWithCoach` to TodayCard.
- Add `sessionChatWorkout` state (`Workout | null`).
- When `onChatWithCoach` fires, set `sessionChatWorkout = todayWorkout`.
- Render `SessionChatModal` when `sessionChatWorkout` is set.
- `onWorkoutUpdated` callback refreshes the workout in the dashboard's workout list state.

---

## Verification

1. TodayCard shows "Chat with coach →" below the briefing when there's a workout today.
2. Tapping opens the bottom sheet with a greeting referencing today's session.
3. Free-form questions get streamed coach responses.
4. Asking to shorten the session produces a proposal card with Approve/Reject.
5. Approving updates the workout — TodayCard and WorkoutCard reflect the new duration.
6. If `week_follow_up` is present, the coach message appears automatically after approval.
7. Saying yes to week adjustment produces a week proposal card listing each change.
8. Rejecting a proposal dismisses the card and coach acknowledges.
9. Modal closes cleanly with no lingering state.
10. On a rest day (no workout), the "Chat with coach →" link does not appear.
