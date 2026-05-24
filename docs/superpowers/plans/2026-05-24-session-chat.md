# Session Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Chat with coach →" link to TodayCard that opens a bottom-sheet conversation pre-loaded with today's workout context, allowing the user to ask questions and approve session modifications in-place.

**Architecture:** A new `SessionChatModal` component streams responses from a new `/api/chat/session` endpoint whose system prompt includes today's workout details, fitness metrics, and structured instructions for emitting `__PROPOSAL__` / `__WEEK_PROPOSAL__` JSON blocks. The frontend parses these blocks after the stream closes and renders inline approve/reject cards. Approving PATCHes the workout record(s) using the existing endpoint.

**Tech Stack:** Next.js App Router, Supabase (RLS), Anthropic streaming SDK (`anthropic.messages.stream`), React state, Tailwind CSS, Jest + `@testing-library/react`

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `types/index.ts` | Add `SessionWorkoutUpdate`, `SessionProposal`, `SessionWeekProposal` |
| Modify | `app/api/workouts/[id]/route.ts` | Extend PATCH to accept `type`, `duration_minutes`, `description`, `target_zones` |
| Create | `lib/claude/session-chat.ts` | System prompt builder (testable pure function) |
| Create | `__tests__/lib/session-chat.test.ts` | Unit tests for system prompt builder |
| Create | `app/api/chat/session/route.ts` | Streaming API endpoint |
| Create | `components/SessionChatModal.tsx` | Bottom-sheet chat component |
| Modify | `components/TodayCard.tsx` | Add `onChatWithCoach` prop + link |
| Modify | `app/dashboard/page.tsx` | Wire up state and render `SessionChatModal` |

---

## Task 1: Add types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add the three new interfaces after `ProposedAdjustment`**

Open `types/index.ts`. After the closing `}` of `ProposedAdjustment` (currently line 83), insert:

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
  week_follow_up?: string
}

export interface SessionWeekProposal {
  changes: WorkoutChange[]
  rationale: string
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors unrelated to this change).

- [ ] **Step 3: Commit**

```powershell
git add types/index.ts
git commit -m "feat: add SessionProposal and SessionWeekProposal types"
```

---

## Task 2: Extend PATCH endpoint to support content fields

**Files:**
- Modify: `app/api/workouts/[id]/route.ts:37-103`

The current PATCH handler only accepts `status`, `icu_activity_id`, `tss`, `missed_reason`, `date`. The session chat needs to update `type`, `duration_minutes`, `description`, and `target_zones`.

- [ ] **Step 1: Add four new fields to the update block**

In `app/api/workouts/[id]/route.ts`, after the line `if (body.missed_reason !== undefined) update.missed_reason = body.missed_reason ?? null` (currently around line 51), add:

```ts
  if (body.type !== undefined) update.type = body.type
  if (body.duration_minutes !== undefined) update.duration_minutes = body.duration_minutes
  if (body.description !== undefined) update.description = body.description
  if (body.target_zones !== undefined) update.target_zones = body.target_zones
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add "app/api/workouts/[id]/route.ts"
git commit -m "feat: extend workout PATCH to accept content fields (type, duration, description)"
```

---

## Task 3: Create session chat system prompt builder

**Files:**
- Create: `lib/claude/session-chat.ts`
- Create: `__tests__/lib/session-chat.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/session-chat.test.ts`:

```ts
import { buildSessionSystemPrompt } from '@/lib/claude/session-chat'
import type { Workout, TrainingPlan, ICUWellness } from '@/types'

const workout: Workout = {
  id: 'wk-today',
  plan_id: 'plan1',
  date: '2026-05-24',
  type: 'threshold',
  duration_minutes: 60,
  description: '2x20min at threshold',
  target_zones: 'Zone 4 (91-105% FTP)',
  intervals_icu_event_id: null,
  status: 'planned',
  icu_activity_id: null,
  tss: null,
  missed_reason: null,
  steps: null,
  created_at: '',
}

const plan: TrainingPlan = {
  id: 'plan1',
  name: 'Gran Fondo Build',
  status: 'active',
  target_event_name: 'Etape du Tour',
  target_event_date: '2026-07-10',
  phase: 'build',
  rationale: 'Progressive build towards A event',
  last_reviewed_week: null,
  created_at: '',
  updated_at: '',
}

const upcoming: Workout[] = [
  { ...workout, id: 'wk-thu', date: '2026-05-27', type: 'endurance', duration_minutes: 90,
    description: 'Zone 2 ride', status: 'planned' },
]

const wellness: ICUWellness = {
  id: '2026-05-24', ctl: 65, atl: 72, form: -7, hrv: 52, resting_hr: 48, sleep_secs: null,
}

describe('buildSessionSystemPrompt', () => {
  it('includes today workout ID and type', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
    expect(prompt).toContain('wk-today')
    expect(prompt).toContain('threshold')
    expect(prompt).toContain('60 min')
  })

  it('includes fitness metrics', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
    expect(prompt).toContain('65')   // CTL
    expect(prompt).toContain('-7')   // form
    expect(prompt).toContain('240W') // FTP
  })

  it('includes upcoming workout IDs for week proposals', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
    expect(prompt).toContain('wk-thu')
  })

  it('includes __PROPOSAL__ instruction', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
    expect(prompt).toContain('__PROPOSAL__')
  })

  it('includes __WEEK_PROPOSAL__ instruction', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
    expect(prompt).toContain('__WEEK_PROPOSAL__')
  })

  it('handles null wellness gracefully', () => {
    expect(() => buildSessionSystemPrompt(workout, null, [], null, 200)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```powershell
npx jest __tests__/lib/session-chat.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/claude/session-chat'`

- [ ] **Step 3: Create `lib/claude/session-chat.ts`**

```ts
import type { Workout, TrainingPlan, ICUWellness } from '@/types'

export function buildSessionSystemPrompt(
  workout: Workout,
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  wellness: ICUWellness | null,
  currentFTP: number,
): string {
  const tsb = wellness?.form ?? (
    wellness?.ctl != null && wellness?.atl != null ? wellness.ctl - wellness.atl : null
  )

  const fitnessSection = wellness
    ? `CTL: ${wellness.ctl ?? '?'}, ATL: ${wellness.atl ?? '?'}, Form: ${tsb != null ? Math.round(tsb) : '?'}, HRV: ${wellness.hrv ?? '?'}`
    : 'No fitness data available.'

  const planSection = plan
    ? `Plan: ${plan.target_event_name} on ${plan.target_event_date} (${plan.phase} phase)`
    : 'No active training plan.'

  const weekSection = upcomingWorkouts.length
    ? upcomingWorkouts.map(w => `- ${w.id} | ${w.date}: ${w.type} ${w.duration_minutes}min — ${w.description}`).join('\n')
    : 'No other upcoming workouts this week.'

  return `You are an expert road cycling coach. Be direct and practical.

TODAY'S SESSION:
ID: ${workout.id}
Type: ${workout.type} | Duration: ${workout.duration_minutes} min
Description: ${workout.description}
Target zones: ${workout.target_zones}

ATHLETE STATE:
${fitnessSection}
FTP: ${currentFTP}W

${planSection}

NEXT 7 DAYS (ID | date: type duration — description):
${weekSection}

Answer questions about today's session. If the athlete asks to modify or rework the session, propose specific changes. When proposing changes, end your response with:

__PROPOSAL__
{"today_update": {"duration_minutes": <number>, "type": "<type>", "description": "<text>", "target_zones": "<text>"}, "rationale": "<short explanation>", "week_follow_up": "<optional: single question asking if they want to adjust the week — omit field if change doesn't affect weekly load>"}

Only include fields in today_update that actually change. Only include week_follow_up if the modification meaningfully shifts weekly training load.

If the athlete agrees to adjust the rest of the week, propose specific changes and end your response with:

__WEEK_PROPOSAL__
{"changes": [{"workout_id": "<id from the list above>", "field": "duration_minutes|description|type", "old_value": <current value>, "new_value": <proposed value>, "reason": "<why>"}], "rationale": "<overall reason>"}

Keep proposals minimal — only change what's necessary.`
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```powershell
npx jest __tests__/lib/session-chat.test.ts --no-coverage
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```powershell
git add lib/claude/session-chat.ts __tests__/lib/session-chat.test.ts
git commit -m "feat: add session chat system prompt builder with tests"
```

---

## Task 4: Create `/api/chat/session` endpoint

**Files:**
- Create: `app/api/chat/session/route.ts`

- [ ] **Step 1: Create the route file**

Create `app/api/chat/session/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { anthropic, MODEL } from '@/lib/claude/client'
import { buildSessionSystemPrompt } from '@/lib/claude/session-chat'
import type { Workout, TrainingPlan, ICUWellness } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  let workoutId: string
  let message: string
  let wellness: ICUWellness | null
  let history: { role: 'user' | 'assistant'; content: string }[]

  try {
    const body = await req.json()
    workoutId = body.workoutId
    message = body.message
    wellness = body.wellness ?? null
    history = body.history ?? []
  } catch {
    return new Response('Invalid request body', { status: 400 })
  }

  if (!message?.trim() || !workoutId) {
    return new Response('workoutId and message required', { status: 400 })
  }

  const [
    { data: workout },
    { data: plan },
    { data: upcomingWorkouts },
    { data: profile },
  ] = await Promise.all([
    supabase.from('workouts').select('*').eq('id', workoutId).maybeSingle(),
    supabase.from('training_plans').select('*').eq('status', 'active').maybeSingle(),
    supabase.from('workouts').select('*').eq('status', 'planned')
      .gt('date', new Date().toISOString().split('T')[0])
      .lte('date', new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0])
      .order('date'),
    supabase.from('user_profile').select('current_ftp').maybeSingle(),
  ])

  if (!workout) return new Response('Workout not found', { status: 404 })

  const currentFTP = (profile as { current_ftp?: number } | null)?.current_ftp ?? 200

  const systemPrompt = buildSessionSystemPrompt(
    workout as Workout,
    plan as TrainingPlan | null,
    (upcomingWorkouts ?? []) as Workout[],
    wellness,
    currentFTP,
  )

  const messages = [
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message },
  ]

  const stream = await anthropic.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  })

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text))
          }
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add app/api/chat/session/route.ts
git commit -m "feat: add /api/chat/session streaming endpoint"
```

---

## Task 5: Create `SessionChatModal` component

**Files:**
- Create: `components/SessionChatModal.tsx`

- [ ] **Step 1: Create the component**

Create `components/SessionChatModal.tsx`:

```tsx
'use client'
import { useState, useRef, useEffect } from 'react'
import type { Workout, ICUWellness, SessionProposal, SessionWeekProposal } from '@/types'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  workout: Workout
  wellness: ICUWellness | null
  onClose: () => void
  onWorkoutUpdated: (updated: Workout) => void
}

function buildOpeningMessage(workout: Workout, wellness: ICUWellness | null): string {
  const tsb = wellness?.form ?? (
    wellness?.ctl != null && wellness?.atl != null ? wellness.ctl - wellness.atl : null
  )
  let readiness = ''
  if (tsb != null) {
    if (tsb > 0) readiness = ` Feeling fresh (+${Math.round(tsb)} TSB).`
    else if (tsb >= -30) readiness = ` Moderate fatigue (${Math.round(tsb)} TSB).`
    else readiness = ` Heavy legs (${Math.round(tsb)} TSB) — worth discussing.`
  }
  return `You've got a ${workout.duration_minutes}min ${workout.type} session today.${readiness} What's on your mind?`
}

const PROPOSAL_MARKER = '\n__PROPOSAL__\n'
const WEEK_MARKER = '\n__WEEK_PROPOSAL__\n'

export default function SessionChatModal({ workout, wellness, onClose, onWorkoutUpdated }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: buildOpeningMessage(workout, wellness) },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [proposal, setProposal] = useState<SessionProposal | null>(null)
  const [weekProposal, setWeekProposal] = useState<SessionWeekProposal | null>(null)
  const [applying, setApplying] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, proposal, weekProposal])

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return
    setInput('')
    // Capture history before adding new user message (stale closure is intentional)
    const history = messages.slice(1)
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    const res = await fetch('/api/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, workoutId: workout.id, wellness, history }),
    })

    if (!res.body) { setLoading(false); return }

    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fullText += decoder.decode(value)
      const cutIdx = Math.min(
        fullText.includes(PROPOSAL_MARKER) ? fullText.indexOf(PROPOSAL_MARKER) : Infinity,
        fullText.includes(WEEK_MARKER) ? fullText.indexOf(WEEK_MARKER) : Infinity,
      )
      const visibleText = cutIdx < Infinity ? fullText.slice(0, cutIdx) : fullText
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: visibleText }
        return updated
      })
    }

    // Parse proposal blocks from the full buffered response
    const proposalIdx = fullText.indexOf(PROPOSAL_MARKER)
    const weekIdx = fullText.indexOf(WEEK_MARKER)

    if (proposalIdx !== -1) {
      try {
        setProposal(JSON.parse(fullText.slice(proposalIdx + PROPOSAL_MARKER.length).trim()) as SessionProposal)
      } catch { /* malformed — ignore */ }
    } else if (weekIdx !== -1) {
      try {
        setWeekProposal(JSON.parse(fullText.slice(weekIdx + WEEK_MARKER.length).trim()) as SessionWeekProposal)
      } catch { /* malformed — ignore */ }
    }

    setLoading(false)
  }

  async function handleApprove() {
    if (!proposal || applying) return
    setApplying(true)
    const res = await fetch(`/api/workouts/${workout.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proposal.today_update),
    })
    if (res.ok) {
      onWorkoutUpdated({ ...workout, ...proposal.today_update })
      const followUp = proposal.week_follow_up
      setProposal(null)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Done — session updated.' }])
      if (followUp) {
        setTimeout(() => setMessages(prev => [...prev, { role: 'assistant', content: followUp }]), 400)
      }
    }
    setApplying(false)
  }

  function handleReject() {
    setProposal(null)
    setMessages(prev => [...prev, { role: 'assistant', content: "No problem — let me know if you'd like to try a different approach." }])
  }

  async function handleWeekApprove() {
    if (!weekProposal || applying) return
    setApplying(true)
    await Promise.all(
      weekProposal.changes.map(c =>
        fetch(`/api/workouts/${c.workout_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [c.field]: c.new_value }),
        })
      )
    )
    setWeekProposal(null)
    setMessages(prev => [...prev, { role: 'assistant', content: "Week adjusted. You're all set." }])
    setApplying(false)
  }

  function handleWeekReject() {
    setWeekProposal(null)
    setMessages(prev => [...prev, { role: 'assistant', content: 'Understood — keeping the rest of the week as planned.' }])
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-white rounded-t-2xl flex flex-col max-h-[85vh] sm:max-w-lg sm:mx-auto sm:w-full sm:rounded-2xl sm:mb-8">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Coach Chat</p>
            <p className="text-sm font-semibold text-slate-800 capitalize">
              {workout.duration_minutes}min {workout.type}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-sm font-medium py-1 px-2 min-h-[44px] flex items-center"
          >
            Close
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : ''}`}>
              <span className={`inline-block rounded-xl px-3 py-2 max-w-[85%] text-sm leading-snug ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-100 text-slate-800 rounded-bl-sm'
              }`}>
                {m.content}
              </span>
            </div>
          ))}

          {/* Today proposal card */}
          {proposal && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Proposed changes</p>
              {proposal.today_update.duration_minutes !== undefined && (
                <p className="text-sm">
                  <span className="text-slate-500">Duration: </span>
                  <span className="font-medium">{workout.duration_minutes}min → {proposal.today_update.duration_minutes}min</span>
                </p>
              )}
              {proposal.today_update.type !== undefined && (
                <p className="text-sm">
                  <span className="text-slate-500">Type: </span>
                  <span className="font-medium capitalize">{workout.type} → {proposal.today_update.type}</span>
                </p>
              )}
              {proposal.today_update.description !== undefined && (
                <p className="text-xs text-slate-600 italic leading-relaxed">{proposal.today_update.description}</p>
              )}
              <p className="text-xs text-slate-500">{proposal.rationale}</p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={handleReject}
                  disabled={applying}
                  className="text-sm text-slate-500 hover:text-slate-700 font-medium px-3 py-2 min-h-[44px]"
                >
                  Reject
                </button>
                <button
                  onClick={handleApprove}
                  disabled={applying}
                  className="text-sm bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
                >
                  {applying ? 'Applying…' : 'Approve'}
                </button>
              </div>
            </div>
          )}

          {/* Week proposal card */}
          {weekProposal && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Week adjustments</p>
              {weekProposal.changes.map((c, i) => (
                <div key={i} className="space-y-0.5">
                  <p className="text-sm">
                    <span className="font-medium capitalize">{String(c.field).replace('_', ' ')}: </span>
                    <span className="text-slate-500">{String(c.old_value)} → {String(c.new_value)}</span>
                  </p>
                  <p className="text-xs text-slate-500">{c.reason}</p>
                </div>
              ))}
              <p className="text-xs text-slate-500 pt-1">{weekProposal.rationale}</p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={handleWeekReject}
                  disabled={applying}
                  className="text-sm text-slate-500 hover:text-slate-700 font-medium px-3 py-2 min-h-[44px]"
                >
                  Reject
                </button>
                <button
                  onClick={handleWeekApprove}
                  disabled={applying}
                  className="text-sm bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
                >
                  {applying ? 'Applying…' : 'Approve all'}
                </button>
              </div>
            </div>
          )}

          {loading && <p className="text-xs text-slate-400 pl-1">Coach is typing…</p>}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="p-3 border-t border-slate-100 flex gap-2 items-center shrink-0">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && sendMessage()}
            placeholder="Ask your coach…"
            className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-full px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            className="w-11 h-11 bg-blue-600 text-white rounded-full flex items-center justify-center hover:bg-blue-700 disabled:opacity-50 shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add components/SessionChatModal.tsx
git commit -m "feat: add SessionChatModal bottom sheet component"
```

---

## Task 6: Wire up TodayCard and dashboard

**Files:**
- Modify: `components/TodayCard.tsx`
- Modify: `app/dashboard/page.tsx`

### TodayCard changes

- [ ] **Step 1: Add `onChatWithCoach` prop to TodayCard**

In `components/TodayCard.tsx`, update the `Props` interface (currently around line 7):

```ts
interface Props {
  workout: Workout | null
  wellness: ICUWellness | null
  onWorkoutClick?: (workout: Workout) => void
  onChatWithCoach?: () => void
}
```

Update the function signature on the same line (currently around line 28):

```ts
export default function TodayCard({ workout, wellness, onWorkoutClick, onChatWithCoach }: Props) {
```

- [ ] **Step 2: Add "Chat with coach →" link below the briefing note**

In `components/TodayCard.tsx`, find the coach note section (the `{!loading && (` button around line 161). After the existing refresh button, add the chat link:

```tsx
          {!loading && onChatWithCoach && workout && (
            <button
              onClick={onChatWithCoach}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
              Chat with coach →
            </button>
          )}
```

The full updated coach note section should look like:

```tsx
      {/* Coach note */}
      <div className="border-t border-slate-100 pt-3 space-y-2">
        {loading ? (
          <p className="text-sm text-slate-400">Getting your briefing…</p>
        ) : coachNote ? (
          <p className="text-sm text-slate-600 leading-relaxed font-light">{coachNote}</p>
        ) : (
          <p className="text-sm text-slate-400 italic">Coach note unavailable.</p>
        )}
        {!loading && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
          >
            {refreshing ? 'Getting note…' : workout?.status === 'completed' ? 'Get post-ride note' : 'Refresh note'}
          </button>
        )}
        {!loading && onChatWithCoach && workout && (
          <button
            onClick={onChatWithCoach}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            Chat with coach →
          </button>
        )}
      </div>
```

### Dashboard changes

- [ ] **Step 3: Add state and import to dashboard**

In `app/dashboard/page.tsx`, add the import at the top (after the existing imports):

```ts
import SessionChatModal from '@/components/SessionChatModal'
```

Inside `DashboardPage()`, after the existing `const [notificationsEnabled, setNotificationsEnabled] = useState(false)` line (around line 106), add:

```ts
  const [sessionChatOpen, setSessionChatOpen] = useState(false)
```

- [ ] **Step 4: Pass `onChatWithCoach` to TodayCard**

Find the `<TodayCard` render in the dashboard (around line 380). Update it to pass the new prop:

```tsx
        <TodayCard
          workout={todayWorkout}
          wellness={latestWellness}
          onWorkoutClick={w => setSelectedWorkout(w)}
          onChatWithCoach={todayWorkout ? () => setSessionChatOpen(true) : undefined}
        />
```

- [ ] **Step 5: Add a function to update a workout in state**

After the `handleReviewApprove` function (around line 256), add:

```ts
  function handleWorkoutUpdated(updated: Workout) {
    setWorkouts(prev => prev.map(w => w.id === updated.id ? updated : w))
  }
```

- [ ] **Step 6: Render `SessionChatModal`**

Find the `{feedbackWorkout && (` block (around line 515). After its closing `)}`, add:

```tsx
      {sessionChatOpen && todayWorkout && (
        <SessionChatModal
          workout={todayWorkout}
          wellness={latestWellness}
          onClose={() => setSessionChatOpen(false)}
          onWorkoutUpdated={handleWorkoutUpdated}
        />
      )}
```

- [ ] **Step 7: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Run all tests**

```powershell
npx jest --no-coverage
```

Expected: all existing tests pass, new session-chat tests pass.

- [ ] **Step 9: Commit**

```powershell
git add components/TodayCard.tsx app/dashboard/page.tsx
git commit -m "feat: wire session chat into TodayCard and dashboard"
```

---

## Verification Checklist

1. Open dashboard — `TodayCard` shows "Chat with coach →" below the briefing note (only when there's a workout today).
2. On a rest day (no workout), the link does not appear.
3. Tapping "Chat with coach →" opens the bottom sheet with a greeting referencing today's duration and type.
4. Tap the backdrop — modal closes.
5. Ask a question (e.g. "What heart rate should I target?") — response streams in.
6. Ask to shorten the session — a proposal card appears with the duration change and Approve/Reject buttons.
7. Tap Reject — card disappears, coach acknowledges with "No problem…"
8. Ask again and tap Approve — workout card in dashboard updates to the new duration. "Done — session updated." appears in chat.
9. If `week_follow_up` was present, the coach question appears ~400ms after approval.
10. Reply yes to the week adjustment question — a week proposal card appears listing each workout change.
11. Approve the week changes — "Week adjusted. You're all set." appears.
12. Close the modal — state resets on next open.
