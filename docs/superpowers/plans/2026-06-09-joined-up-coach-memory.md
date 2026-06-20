# Joined-Up Coach Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a single append-only `coach_messages` log across all five coach chat surfaces so the coach can recall cross-surface conversations, backed by a shared persona constant and context head, plus an optional nightly digest.

**Architecture:** Phase 1 creates `coach_messages`, backfills legacy tables, adds `loadCoachMemory` (recent transcript), and wires all five surfaces to persist and inject memory — independently shippable and the core "it remembers" win. Phase 2 adds the `coach_conversation_memory` nightly digest table and `synthesizeConversationMemory`, extending `loadCoachMemory` with long-term continuity.

**Tech Stack:** Supabase (Postgres + RLS), Next.js App Router API routes, Anthropic SDK (`claude-opus-4-8`), TypeScript, Jest.

---

## File Map

**Create (Phase 1):**
- `supabase/migrations/20260609_coach_messages.sql` — unified log table + RLS + idempotent backfill
- `lib/claude/coach-memory.ts` — `COACH_PERSONA`, `buildCoachContext`, `loadCoachMemory`
- `__tests__/lib/coach-memory.test.ts` — unit tests

**Modify (Phase 1):**
- `types/index.ts` — add `CoachMessage`
- `lib/claude/chat.ts` — add `memoryBlock` param, use `buildCoachContext`
- `lib/claude/session-chat.ts` — add `memoryBlock` param, use `buildCoachContext`
- `lib/claude/feedback-chat.ts` — add `memoryBlock` param, use `buildCoachContext`
- `lib/claude/interview.ts` — add `memoryBlock` param, use `buildCoachContext`
- `app/api/chat/route.ts` — call `loadCoachMemory`, dual-write to `coach_messages`
- `app/api/chat/session/route.ts` — call `loadCoachMemory`, persist both turns
- `app/api/chat/plan/route.ts` — call `loadCoachMemory`, persist both turns
- `app/api/chat/interview/route.ts` — call `loadCoachMemory`, persist both turns
- `app/api/feedback/chat/route.ts` — call `loadCoachMemory`, dual-write
- `lib/claude/synthesize-dossier.ts` — read from `coach_messages` (unified)
- `__tests__/lib/synthesize-dossier.test.ts` — update mock to serve `coach_messages`

**Create (Phase 2):**
- `supabase/migrations/20260609_coach_conversation_memory.sql` — digest table + RLS
- `lib/claude/synthesize-conversation-memory.ts` — `synthesizeConversationMemory`
- `__tests__/lib/synthesize-conversation-memory.test.ts`

**Modify (Phase 2):**
- `types/index.ts` — add `CoachConversationMemory`
- `lib/claude/coach-memory.ts` — extend `loadCoachMemory` to append CONVERSATION MEMORY
- `app/api/cron/dossier/route.ts` — call `synthesizeConversationMemory` in cron loop
- `CLAUDE.md` — add model table row for conversation memory synthesis

---

## PHASE 1 — Unified log + recent transcript + shared persona

---

### Task 1: Migration — coach_messages table + idempotent backfill

**Files:**
- Create: `supabase/migrations/20260609_coach_messages.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Unified cross-surface conversation log.
create table if not exists coach_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  surface     text not null check (surface in ('coach','plan','workout','feedback','interview')),
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  context     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists coach_messages_user_created_idx
  on coach_messages (user_id, created_at desc);

create index if not exists coach_messages_context_idx
  on coach_messages using gin (context)
  where context is not null;

alter table coach_messages enable row level security;

create policy "own data" on coach_messages
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Idempotent backfill: chat_messages → coach_messages (surface='coach')
insert into coach_messages (id, user_id, surface, role, content, context, created_at)
select id, user_id, 'coach', role, content, null, created_at
from chat_messages
where not exists (
  select 1 from coach_messages cm where cm.id = chat_messages.id
);

-- Idempotent backfill: feedback_messages → coach_messages (surface='feedback')
insert into coach_messages (id, user_id, surface, role, content, context, created_at)
select id, user_id, 'feedback', role, content,
  jsonb_build_object('feedback_id', feedback_id),
  created_at
from feedback_messages
where not exists (
  select 1 from coach_messages cm where cm.id = feedback_messages.id
);
```

- [ ] **Step 2: Apply the migration**

Run the SQL in the Supabase SQL editor. Verify in the Table Editor that `coach_messages` exists with the correct columns and that rows from `chat_messages` and `feedback_messages` appear in it.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260609_coach_messages.sql
git commit -m "feat: add coach_messages unified log table and backfill

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Types — CoachMessage

**Files:**
- Modify: `types/index.ts`
- Create: `__tests__/lib/coach-memory.test.ts` (scaffolding for Task 3)

- [ ] **Step 1: Write scaffolding test (will grow in Task 3)**

Create `__tests__/lib/coach-memory.test.ts`:

```ts
/** @jest-environment node */
import type { CoachMessage } from '@/types'

describe('CoachMessage type', () => {
  it('accepts a valid coach message object', () => {
    const msg: CoachMessage = {
      id: 'abc',
      user_id: 'u1',
      surface: 'coach',
      role: 'user',
      content: 'hello',
      context: null,
      created_at: '2026-06-09T10:00:00Z',
    }
    expect(msg.surface).toBe('coach')
  })
})
```

- [ ] **Step 2: Run type check — expect error (type not defined yet)**

```bash
npx tsc --noEmit 2>&1 | grep CoachMessage
```

Expected: `Cannot find name 'CoachMessage'`

- [ ] **Step 3: Add CoachMessage to types/index.ts**

After the `ChatMessage` interface (around line 216), add:

```ts
export interface CoachMessage {
  id: string
  user_id: string
  surface: 'coach' | 'plan' | 'workout' | 'feedback' | 'interview'
  role: 'user' | 'assistant'
  content: string
  context: { workout_id?: string; plan_id?: string; feedback_id?: string } | null
  created_at: string
}
```

- [ ] **Step 4: Run type check**

```bash
npx tsc --noEmit
```

Expected: passes (or only pre-existing errors)

- [ ] **Step 5: Run test**

```bash
npx jest __tests__/lib/coach-memory.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add types/index.ts __tests__/lib/coach-memory.test.ts
git commit -m "feat: add CoachMessage type

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: lib/claude/coach-memory.ts — COACH_PERSONA, buildCoachContext, loadCoachMemory

**Files:**
- Create: `lib/claude/coach-memory.ts`
- Modify: `__tests__/lib/coach-memory.test.ts`

- [ ] **Step 1: Write failing tests**

Replace `__tests__/lib/coach-memory.test.ts` with:

```ts
/** @jest-environment node */
import { buildCoachContext, loadCoachMemory, COACH_PERSONA } from '@/lib/claude/coach-memory'
import type { CoachMessage } from '@/types'

// ── buildCoachContext ─────────────────────────────────────────────────────────

describe('buildCoachContext', () => {
  it('starts with COACH_PERSONA', () => {
    expect(buildCoachContext('', '').startsWith(COACH_PERSONA)).toBe(true)
  })

  it('includes memory block when non-empty', () => {
    expect(buildCoachContext('RECENT CONVERSATIONS:\nfoo', '')).toContain('RECENT CONVERSATIONS:\nfoo')
  })

  it('includes dossier section when non-empty', () => {
    expect(buildCoachContext('', "COACH'S NOTES\ncontent")).toContain("COACH'S NOTES")
  })

  it('returns just COACH_PERSONA when both args are empty', () => {
    expect(buildCoachContext('', '').trim()).toBe(COACH_PERSONA.trim())
  })

  it('orders: persona → memory → dossier', () => {
    const result = buildCoachContext('MEMORY', 'DOSSIER')
    expect(result.indexOf('MEMORY')).toBeLessThan(result.indexOf('DOSSIER'))
    expect(result.indexOf(COACH_PERSONA)).toBeLessThan(result.indexOf('MEMORY'))
  })
})

// ── loadCoachMemory ────────────────────────────────────────────────────────────

function makeSupabase(rows: Partial<CoachMessage>[], shouldError = false) {
  return {
    from: () => ({
      select: function () { return this },
      eq: function () { return this },
      gte: function () { return this },
      order: function () { return this },
      limit: () =>
        Promise.resolve(
          shouldError
            ? { data: null, error: { message: 'db error' } }
            : { data: rows, error: null },
        ),
    }),
  }
}

const NOW = '2026-06-09T12:00:00Z'

const rows: CoachMessage[] = [
  { id: '1', user_id: 'u1', surface: 'workout', role: 'user', content: 'felt good', context: { workout_id: 'w1' }, created_at: '2026-06-08T10:00:00Z' },
  { id: '2', user_id: 'u1', surface: 'workout', role: 'assistant', content: 'great effort', context: { workout_id: 'w1' }, created_at: '2026-06-08T10:01:00Z' },
  { id: '3', user_id: 'u1', surface: 'coach', role: 'user', content: 'coach question', context: null, created_at: '2026-06-07T09:00:00Z' },
]

describe('loadCoachMemory', () => {
  it('returns empty string when no messages', async () => {
    expect(await loadCoachMemory(makeSupabase([]) as never, 'u1', {}, NOW)).toBe('')
  })

  it('returns empty string on db error', async () => {
    expect(await loadCoachMemory(makeSupabase([], true) as never, 'u1', {}, NOW)).toBe('')
  })

  it('returns RECENT CONVERSATIONS block when messages exist', async () => {
    const result = await loadCoachMemory(makeSupabase(rows) as never, 'u1', {}, NOW)
    expect(result).toContain('RECENT CONVERSATIONS')
    expect(result).toContain('felt good')
    expect(result).toContain('great effort')
  })

  it('excludes messages matching excludeSurface', async () => {
    const result = await loadCoachMemory(makeSupabase(rows) as never, 'u1', { excludeSurface: 'coach' }, NOW)
    expect(result).not.toContain('coach question')
    expect(result).toContain('felt good')
  })

  it('excludes messages matching excludeContextKey/Value', async () => {
    const result = await loadCoachMemory(makeSupabase(rows) as never, 'u1', { excludeContextKey: 'workout_id', excludeContextValue: 'w1' }, NOW)
    expect(result).not.toContain('felt good')
    expect(result).toContain('coach question')
  })

  it('labels turns with surface and relative day', async () => {
    const result = await loadCoachMemory(makeSupabase([rows[0]]) as never, 'u1', {}, NOW)
    expect(result).toContain('[workout,')
    expect(result).toContain('yesterday')
  })
})
```

- [ ] **Step 2: Run tests — expect import error**

```bash
npx jest __tests__/lib/coach-memory.test.ts 2>&1 | head -5
```

Expected: FAIL — `Cannot find module '@/lib/claude/coach-memory'`

- [ ] **Step 3: Create lib/claude/coach-memory.ts**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CoachMessage } from '@/types'

export const COACH_PERSONA =
  `You are an expert road cycling coach messaging your athlete directly. Be direct and conversational — like a coach texting between sessions. No markdown, no bullet points, no headers, no bold text. Plain prose only. Keep responses concise unless the athlete asks for detail.`

export function buildCoachContext(memoryBlock: string, dossierSection: string): string {
  const parts = [COACH_PERSONA]
  if (memoryBlock) parts.push('', memoryBlock)
  if (dossierSection) parts.push('', dossierSection)
  return parts.join('\n')
}

export interface LoadMemoryOpts {
  excludeSurface?: string
  excludeContextKey?: string
  excludeContextValue?: string
}

function relativeDay(msgCreatedAt: string, now: string): string {
  const diffMs = new Date(now).getTime() - new Date(msgCreatedAt).getTime()
  const days = Math.floor(diffMs / 864e5)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export async function loadCoachMemory(
  supabase: SupabaseClient,
  userId: string,
  opts: LoadMemoryOpts = {},
  now = new Date().toISOString(),
): Promise<string> {
  try {
    const sevenDaysAgo = new Date(new Date(now).getTime() - 7 * 864e5).toISOString()

    const { data } = await supabase
      .from('coach_messages')
      .select('id, surface, role, content, context, created_at')
      .eq('user_id', userId)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(50)

    const messages = (data ?? []) as CoachMessage[]

    const filtered = messages
      .filter(m => {
        if (opts.excludeSurface && m.surface === opts.excludeSurface) return false
        if (opts.excludeContextKey && opts.excludeContextValue) {
          const ctx = m.context as Record<string, string> | null
          if (ctx?.[opts.excludeContextKey] === opts.excludeContextValue) return false
        }
        return true
      })
      .slice(0, 25)
      .reverse()

    if (!filtered.length) return ''

    const lines = filtered.map(m => {
      const day = relativeDay(m.created_at, now)
      const who = m.role === 'user' ? 'Athlete' : 'Coach'
      return `[${m.surface}, ${day}] ${who}: ${m.content}`
    })

    return `RECENT CONVERSATIONS (across all your coaching):\n${lines.join('\n')}`
  } catch {
    return ''
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/lib/coach-memory.test.ts
```

Expected: all PASS

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add lib/claude/coach-memory.ts __tests__/lib/coach-memory.test.ts
git commit -m "feat: add coach-memory (COACH_PERSONA, buildCoachContext, loadCoachMemory)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Wire coach surface (/api/chat) — dual-write + memory injection

**Files:**
- Modify: `lib/claude/chat.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `__tests__/lib/chat-prompt.test.ts`

- [ ] **Step 1: Add failing tests for memoryBlock param**

In `__tests__/lib/chat-prompt.test.ts`, add at the end of the `describe` block:

```ts
it('includes memory block when provided', () => {
  const p = buildChatSystemPrompt(
    plan, upcoming, wellness, 240, events, '', [], null,
    'RECENT CONVERSATIONS:\n[workout, yesterday] Athlete: felt great',
  )
  expect(p).toContain('RECENT CONVERSATIONS')
  expect(p).toContain('felt great')
})

it('omits memory block when empty string', () => {
  const p = buildChatSystemPrompt(plan, upcoming, wellness, 240, events, '', [], null, '')
  expect(p).not.toContain('RECENT CONVERSATIONS')
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest __tests__/lib/chat-prompt.test.ts 2>&1 | tail -10
```

Expected: FAIL — extra argument is ignored, `RECENT CONVERSATIONS` assertion fails

- [ ] **Step 3: Update lib/claude/chat.ts**

Add import at the top:
```ts
import { buildCoachContext } from './coach-memory'
```

Add `memoryBlock = ''` as the last parameter of `buildChatSystemPrompt` (after `hrvStatus`):

```ts
export function buildChatSystemPrompt(
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  latestWellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[],
  dossierSection = '',
  recentRides: RecentRide[] = [],
  hrvStatus?: HrvStatus | null,
  memoryBlock = '',
): string {
```

In the return template literal, make two changes:

1. Replace the opening persona paragraph (the "You are an expert road cycling coach messaging your athlete directly..." sentence through "...asks for a detailed breakdown.") with `${buildCoachContext(memoryBlock, dossierSection)}`.

2. Remove the existing dossier injection near the bottom. Find and delete `${dossierSection ? dossierSection + '\n\n' : ''}` — it is now handled by `buildCoachContext` above.

The return statement should now open:

```ts
  return `${buildCoachContext(memoryBlock, dossierSection)}

TODAY: ${today} (${weekday})

${planSection}
...
```

And the section that was `${dossierSection ? dossierSection + '\n\n' : ''}Answer questions about training...` becomes simply `Answer questions about training...`.

- [ ] **Step 4: Run chat-prompt tests**

```bash
npx jest __tests__/lib/chat-prompt.test.ts
```

Expected: all PASS including the two new tests

- [ ] **Step 5: Update app/api/chat/route.ts**

Add import:
```ts
import { loadCoachMemory } from '@/lib/claude/coach-memory'
```

Add `loadCoachMemory` as the **first** item in the existing `Promise.all` so it runs in parallel with the other fetches:

```ts
const [memoryBlock, { data: plan }, { data: recentMessages }, { data: upcomingWorkouts }, { data: profileData }, dossier, { data: recentRides }] = await Promise.all([
  loadCoachMemory(supabase, userId, { excludeSurface: 'coach' }),
  supabase.from('training_plans').select('*').eq('status', 'active').maybeSingle(),
  supabase.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(20),
  supabase.from('workouts').select('*').eq('status', 'planned')
    .gte('date', new Date().toISOString().split('T')[0])
    .lte('date', new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0])
    .order('date'),
  supabase.from('user_profile').select('events, intervals_icu_athlete_id, intervals_icu_api_key').maybeSingle(),
  fetchDossier(supabase, user.id),
  supabase.from('workouts')
    .select('date, type, duration_minutes, steps, activity_metrics')
    .eq('status', 'completed')
    .not('activity_metrics', 'is', null)
    .order('date', { ascending: false })
    .limit(5),
])
```

Pass `memoryBlock` as the last argument to `buildChatSystemPrompt`:

```ts
const systemPrompt = buildChatSystemPrompt(
  plan as TrainingPlan | null,
  (upcomingWorkouts ?? []) as Workout[],
  latestWellness,
  currentFTP,
  events,
  formatDossier(dossier as AthleteDossier | null),
  (recentRides ?? []) as import('@/lib/claude/chat').RecentRide[],
  hrvStatus,
  memoryBlock,
)
```

Replace the single user-turn insert with a dual-write:

```ts
await Promise.all([
  supabase.from('chat_messages').insert({ role: 'user', content: message, user_id: userId }),
  supabase.from('coach_messages').insert({ user_id: userId, surface: 'coach', role: 'user', content: message, context: null }),
])
```

Replace the single assistant-turn insert (inside the stream close handler) with a dual-write:

```ts
await Promise.all([
  supabase.from('chat_messages').insert({ role: 'assistant', content: fullResponse, user_id: userId }),
  supabase.from('coach_messages').insert({ user_id: userId, surface: 'coach', role: 'assistant', content: fullResponse, context: null }),
])
```

- [ ] **Step 6: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add lib/claude/chat.ts app/api/chat/route.ts __tests__/lib/chat-prompt.test.ts
git commit -m "feat: wire coach surface to unified log and inject memory block

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Wire workout surface (/api/chat/session) — persist + memory injection

**Files:**
- Modify: `lib/claude/session-chat.ts`
- Modify: `app/api/chat/session/route.ts`
- Modify: `__tests__/lib/session-chat.test.ts`

- [ ] **Step 1: Add failing tests**

In `__tests__/lib/session-chat.test.ts`, add these at the end of the `describe` block (the file already has `workout`, `plan`, `upcoming`, `wellness` fixtures):

```ts
import { COACH_PERSONA } from '@/lib/claude/coach-memory'

// inside describe('buildSessionSystemPrompt', ...):
it('includes memory block when provided', () => {
  const p = buildSessionSystemPrompt(
    workout, plan, upcoming, wellness, 240, [], '', null,
    'RECENT CONVERSATIONS:\n[coach, yesterday] Athlete: knee hurts',
  )
  expect(p).toContain('RECENT CONVERSATIONS')
  expect(p).toContain('knee hurts')
})

it('starts with COACH_PERSONA when memory block is provided', () => {
  const p = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240, [], '', null, 'MEM')
  expect(p.startsWith(COACH_PERSONA)).toBe(true)
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest __tests__/lib/session-chat.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Update lib/claude/session-chat.ts**

Add import:
```ts
import { buildCoachContext } from './coach-memory'
```

Add `memoryBlock = ''` as the last parameter of `buildSessionSystemPrompt` (after `hrvStatus`):

```ts
export function buildSessionSystemPrompt(
  workout: Workout,
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  wellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[] = [],
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  memoryBlock = '',
): string {
```

In the return template literal:
1. Replace the opening "You are an expert road cycling coach messaging your athlete directly..." paragraph with `${buildCoachContext(memoryBlock, dossierSection)}`
2. Remove the existing `${dossierSection ? dossierSection + '\n\n' : ''}` from the prompt body

The return now opens:

```ts
  return `${buildCoachContext(memoryBlock, dossierSection)}

TODAY: ${today} (${weekday})

TODAY'S SESSION:
...`
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/lib/session-chat.test.ts
```

Expected: all PASS

- [ ] **Step 5: Update app/api/chat/session/route.ts**

Add import:
```ts
import { loadCoachMemory } from '@/lib/claude/coach-memory'
```

Add `loadCoachMemory` as the first item in the `Promise.all`:

```ts
const [
  memoryBlock,
  { data: workout },
  { data: plan },
  { data: upcomingWorkouts },
  { data: profile },
  dossierRow,
] = await Promise.all([
  loadCoachMemory(supabase, user.id, { excludeContextKey: 'workout_id', excludeContextValue: workoutId }),
  supabase.from('workouts').select('*').eq('id', workoutId).maybeSingle(),
  supabase.from('training_plans').select('*').eq('status', 'active').maybeSingle(),
  supabase.from('workouts').select('*').eq('status', 'planned')
    .gt('date', new Date().toISOString().split('T')[0])
    .lte('date', new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0])
    .order('date'),
  supabase.from('user_profile').select('current_ftp, events, intervals_icu_athlete_id, intervals_icu_api_key').maybeSingle(),
  fetchDossier(supabase, user.id),
])
```

Pass `memoryBlock` to `buildSessionSystemPrompt`:

```ts
const systemPrompt = buildSessionSystemPrompt(
  workout as Workout,
  plan as TrainingPlan | null,
  (upcomingWorkouts ?? []) as Workout[],
  wellness,
  currentFTP,
  events,
  formatDossier(dossierRow as AthleteDossier | null),
  hrvStatus,
  memoryBlock,
)
```

Persist the user turn before streaming (add after the `if (!workout)` guard):

```ts
await supabase.from('coach_messages').insert({
  user_id: user.id, surface: 'workout', role: 'user',
  content: message, context: { workout_id: workoutId },
})
```

The route currently does NOT capture `fullResponse`. Add `let fullResponse = ''`, accumulate in the stream loop, and persist the assistant turn after stream close:

```ts
let fullResponse = ''
const readable = new ReadableStream({
  async start(controller) {
    try {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullResponse += chunk.delta.text
          controller.enqueue(new TextEncoder().encode(chunk.delta.text))
        }
      }
      await supabase.from('coach_messages').insert({
        user_id: user.id, surface: 'workout', role: 'assistant',
        content: fullResponse, context: { workout_id: workoutId },
      })
      controller.close()
    } catch (err) {
      controller.error(err)
    }
  },
})
```

- [ ] **Step 6: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add lib/claude/session-chat.ts app/api/chat/session/route.ts __tests__/lib/session-chat.test.ts
git commit -m "feat: wire workout surface to unified log and inject memory block

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Wire plan surface (/api/chat/plan) — persist + memory injection

**Files:**
- Modify: `app/api/chat/plan/route.ts`

The plan-chat system-prompt builder (`buildSystemPrompt`) is defined inline in the route file.

- [ ] **Step 1: Update app/api/chat/plan/route.ts**

Add import at the top:
```ts
import { loadCoachMemory, buildCoachContext } from '@/lib/claude/coach-memory'
```

Add `memoryBlock = ''` as the last parameter of the inline `buildSystemPrompt` function:

```ts
function buildSystemPrompt(
  plan: TrainingPlan,
  futureWorkouts: Workout[],
  wellness: ICUWellness | null,
  currentFTP: number,
  profile: UserProfile,
  dossierSection = '',
  unavailability: UnavailabilityPeriod[] = [],
  memoryBlock = '',
): string {
```

In the return template literal of `buildSystemPrompt`:
1. Replace the opening "You are an expert road cycling coach discussing and adapting a training plan..." paragraph with `${buildCoachContext(memoryBlock, dossierSection)}`
2. Remove the existing `${dossierSection ? dossierSection + '\n\n' : ''}` from the prompt body
3. Keep the plan-specific task sentence as the first line after the shared head:

```ts
  return `${buildCoachContext(memoryBlock, dossierSection)}

You are discussing and adapting a training plan with your athlete.

TODAY: ${today} (${weekday})
...`
```

In the `POST` handler, the plan ID is needed for `loadCoachMemory`. Load plan/profile/dossier first, then load memory + future workouts in a second `Promise.all`:

```ts
// First fetch (plan ID needed before we can scope the memory query)
const [{ data: plan }, { data: profile }, dossier] = await Promise.all([
  supabase.from('training_plans').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  supabase.from('user_profile').select('*').maybeSingle(),
  fetchDossier(supabase, user.id),
])

if (!plan) return new Response('No active plan', { status: 400 })
if (!profile) return new Response('Profile not configured', { status: 400 })

const today = new Date().toISOString().split('T')[0]

// Second fetch (now we have plan.id)
const [memoryBlock, { data: futureWorkouts }] = await Promise.all([
  loadCoachMemory(supabase, user.id, { excludeContextKey: 'plan_id', excludeContextValue: plan.id }),
  supabase.from('workouts').select('*').eq('plan_id', plan.id).eq('status', 'planned').gte('date', today).order('date'),
])
```

Pass `memoryBlock` to `buildSystemPrompt`:

```ts
const systemPrompt = buildSystemPrompt(
  plan as TrainingPlan,
  (futureWorkouts ?? []) as Workout[],
  wellness,
  currentFTP,
  profile as unknown as UserProfile,
  formatDossier(dossier as AthleteDossier | null),
  ((profile as Record<string, unknown>).unavailability ?? []) as UnavailabilityPeriod[],
  memoryBlock,
)
```

Persist user turn before streaming:

```ts
await supabase.from('coach_messages').insert({
  user_id: user.id, surface: 'plan', role: 'user',
  content: message, context: { plan_id: plan.id },
})
```

Add `let fullResponse = ''`, accumulate in stream loop, and persist assistant turn after stream close:

```ts
let fullResponse = ''
const readable = new ReadableStream({
  async start(controller) {
    try {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullResponse += chunk.delta.text
          controller.enqueue(new TextEncoder().encode(chunk.delta.text))
        }
      }
      await supabase.from('coach_messages').insert({
        user_id: user.id, surface: 'plan', role: 'assistant',
        content: fullResponse, context: { plan_id: (plan as TrainingPlan).id },
      })
      controller.close()
    } catch (err) {
      controller.error(err)
    }
  },
})
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/plan/route.ts
git commit -m "feat: wire plan surface to unified log and inject memory block

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Wire interview surface (/api/chat/interview) — persist + memory injection

**Files:**
- Modify: `lib/claude/interview.ts`
- Modify: `app/api/chat/interview/route.ts`
- Modify: `__tests__/lib/interview.test.ts`

Current `buildInterviewSystemPrompt` signature (line 52 of `lib/claude/interview.ts`):
```ts
export function buildInterviewSystemPrompt(
  profile: UserProfile,
  wellness: ICUWellness | null,
  currentFTP: number,
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
): string
```

- [ ] **Step 1: Add failing test**

In `__tests__/lib/interview.test.ts`, add inside the `describe` block (the file already uses `makeProfile()`, `wellness`, and `250` as FTP):

```ts
import { COACH_PERSONA } from '@/lib/claude/coach-memory'

// inside describe('buildInterviewSystemPrompt', ...):
it('includes memory block when provided', () => {
  const p = buildInterviewSystemPrompt(
    makeProfile(), wellness, 250, '', null,
    'RECENT CONVERSATIONS:\n[coach, yesterday] Athlete: left knee pain',
  )
  expect(p).toContain('RECENT CONVERSATIONS')
  expect(p).toContain('left knee pain')
})

it('starts with COACH_PERSONA when memory block provided', () => {
  const p = buildInterviewSystemPrompt(makeProfile(), wellness, 250, '', null, 'MEM')
  expect(p.startsWith(COACH_PERSONA)).toBe(true)
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest __tests__/lib/interview.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Update lib/claude/interview.ts**

Add import:
```ts
import { buildCoachContext } from './coach-memory'
```

Add `memoryBlock = ''` as the 6th parameter (after `hrvStatus`):

```ts
export function buildInterviewSystemPrompt(
  profile: UserProfile,
  wellness: ICUWellness | null,
  currentFTP: number,
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  memoryBlock = '',
): string {
```

In the return template literal:
1. Replace the opening persona paragraph with `${buildCoachContext(memoryBlock, dossierSection)}`
2. Remove any existing dossier injection

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/lib/interview.test.ts
```

Expected: all PASS

- [ ] **Step 5: Update app/api/chat/interview/route.ts**

Add import:
```ts
import { loadCoachMemory } from '@/lib/claude/coach-memory'
```

Add `memoryBlock` to the `Promise.all` (interview has no context anchor; exclude the interview surface):

```ts
const [{ data: profile }, dossier, memoryBlock] = await Promise.all([
  supabase.from('user_profile').select('*').maybeSingle(),
  fetchDossier(supabase, user.id),
  loadCoachMemory(supabase, user.id, { excludeSurface: 'interview' }),
])
```

Pass `memoryBlock` to `buildInterviewSystemPrompt` as the 6th argument:

```ts
const systemPrompt = buildInterviewSystemPrompt(
  profile as unknown as UserProfile,
  wellness,
  currentFTP,
  formatDossier(dossier as AthleteDossier | null),
  hrvStatus,
  memoryBlock,
)
```

Persist user turn before streaming:

```ts
await supabase.from('coach_messages').insert({
  user_id: user.id, surface: 'interview', role: 'user',
  content: message.trim() || "Let's begin.", context: null,
})
```

Add `let fullResponse = ''`, accumulate in stream loop, and persist assistant turn after stream close:

```ts
let fullResponse = ''
const readable = new ReadableStream({
  async start(controller) {
    try {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullResponse += chunk.delta.text
          controller.enqueue(new TextEncoder().encode(chunk.delta.text))
        }
      }
      await supabase.from('coach_messages').insert({
        user_id: user.id, surface: 'interview', role: 'assistant',
        content: fullResponse, context: null,
      })
      controller.close()
    } catch (err) {
      controller.error(err)
    }
  },
})
```

- [ ] **Step 6: Type check and run tests**

```bash
npx tsc --noEmit && npx jest __tests__/lib/interview.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add lib/claude/interview.ts app/api/chat/interview/route.ts __tests__/lib/interview.test.ts
git commit -m "feat: wire interview surface to unified log and inject memory block

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Wire feedback surface (/api/feedback/chat) — dual-write + memory injection

**Files:**
- Modify: `lib/claude/feedback-chat.ts`
- Modify: `app/api/feedback/chat/route.ts`
- Modify: `__tests__/lib/feedback-chat.test.ts`

Current `buildFeedbackChatSystemPrompt` signature: `(workout, signals, rideExecution, coachNote)`.

- [ ] **Step 1: Add failing tests**

In `__tests__/lib/feedback-chat.test.ts`, add inside the `describe` block (the file already has `workout` and signal fixtures):

```ts
import { COACH_PERSONA } from '@/lib/claude/coach-memory'

// inside describe('buildFeedbackChatSystemPrompt', ...):
it('includes memory block when provided', () => {
  const p = buildFeedbackChatSystemPrompt(
    workout,
    { rpe: 7, feel: 3, completion: 'as_planned', tags: [], mood: null },
    '',
    '',
    'RECENT CONVERSATIONS:\n[plan, yesterday] Athlete: tired legs',
  )
  expect(p).toContain('RECENT CONVERSATIONS')
  expect(p).toContain('tired legs')
})

it('starts with COACH_PERSONA when memory block provided', () => {
  const p = buildFeedbackChatSystemPrompt(workout, {}, '', '', 'MEM')
  expect(p.startsWith(COACH_PERSONA)).toBe(true)
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest __tests__/lib/feedback-chat.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Update lib/claude/feedback-chat.ts**

Add import:
```ts
import { buildCoachContext } from './coach-memory'
```

Add `memoryBlock = ''` as the 5th parameter:

```ts
export function buildFeedbackChatSystemPrompt(
  workout: Workout,
  signals: SessionSignals,
  rideExecution: string,
  coachNote: string,
  memoryBlock = '',
): string {
```

The prompt is built by pushing to a `lines` array. The first item currently is the persona sentence. Replace the first element with `buildCoachContext(memoryBlock, '')` plus the surface-specific task sentence:

```ts
  const lines: string[] = [
    buildCoachContext(memoryBlock, ''),
    ``,
    `You are discussing a session this athlete has just completed and logged feedback for.`,
    ``,
    `THE SESSION:`,
    ...
  ]
```

(Delete the old opening `You are the athlete's cycling coach...` string.)

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/lib/feedback-chat.test.ts
```

Expected: all PASS

- [ ] **Step 5: Update app/api/feedback/chat/route.ts**

Add import:
```ts
import { loadCoachMemory } from '@/lib/claude/coach-memory'
```

After loading `feedbackRow` and `workout` (the two sequential DB fetches), fetch `memoryBlock`:

```ts
const memoryBlock = await loadCoachMemory(supabase, userId, {
  excludeContextKey: 'feedback_id',
  excludeContextValue: feedbackId,
})
```

Pass `memoryBlock` to `buildFeedbackChatSystemPrompt`:

```ts
const systemPrompt = buildFeedbackChatSystemPrompt(
  workout,
  {
    rpe: feedback.rpe, feel: feedback.feel, completion: feedback.completion,
    tags: feedback.tags, mood: feedback.mood,
  },
  rideExecution,
  feedback.coach_note ?? '',
  memoryBlock,
)
```

Replace the single user-turn insert with a dual-write:

```ts
await Promise.all([
  supabase.from('feedback_messages').insert({
    feedback_id: feedbackId, user_id: userId, role: 'user', content: message,
  }),
  supabase.from('coach_messages').insert({
    user_id: userId, surface: 'feedback', role: 'user',
    content: message, context: { feedback_id: feedbackId },
  }),
])
```

Replace the single assistant-turn insert (after stream completes) with a dual-write:

```ts
await Promise.all([
  supabase.from('feedback_messages').insert({
    feedback_id: feedbackId, user_id: userId, role: 'assistant', content: fullResponse,
  }),
  supabase.from('coach_messages').insert({
    user_id: userId, surface: 'feedback', role: 'assistant',
    content: fullResponse, context: { feedback_id: feedbackId },
  }),
])
```

- [ ] **Step 6: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add lib/claude/feedback-chat.ts app/api/feedback/chat/route.ts __tests__/lib/feedback-chat.test.ts
git commit -m "feat: wire feedback surface to unified log and inject memory block

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Update dossier synthesis to read from coach_messages

**Files:**
- Modify: `lib/claude/synthesize-dossier.ts`
- Modify: `__tests__/lib/synthesize-dossier.test.ts`

`generateDossier` (in `lib/claude/dossier.ts`) takes `chatMessages` and `feedbackDiscussions` as the 8th and 9th params. Currently `synthesizeDossier` reads them from `chat_messages` and `feedback_messages` separately. After this task, both come from `coach_messages` as a single unified read.

- [ ] **Step 1: Update __tests__/lib/synthesize-dossier.test.ts**

In the `makeSupabase` helper, replace the `chat_messages` and `feedback_messages` cases with `coach_messages`:

```ts
function makeSupabase(opts: {
  workouts?: unknown[]
  feedbacks?: unknown[]
  coachMessages?: unknown[]   // replaces chat + discussions
  existing?: unknown
  upsertSpy?: jest.Mock
}) {
  return {
    from: (table: string) => {
      switch (table) {
        case 'workouts': return chain({ data: opts.workouts ?? [] })
        case 'session_feedback': return chain({ data: opts.feedbacks ?? [] })
        case 'coach_messages': return chain({ data: opts.coachMessages ?? [] })
        case 'athlete_dossier': return chain({ data: opts.existing ?? null }, opts.upsertSpy)
        default: return chain({ data: null })
      }
    },
  }
}
```

Update any existing test that passed `chat: [...]` or `discussions: [...]` to pass `coachMessages: [...]` instead.

Add a new test:

```ts
it('reads from coach_messages and passes content to generateDossier', async () => {
  (generateDossier as jest.Mock).mockResolvedValue(fakeContent)
  const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
  const supabase = makeSupabase({
    coachMessages: [{ role: 'user', content: 'discussed knee pain', surface: 'workout' }],
    upsertSpy,
  })
  await synthesizeDossier(supabase as never, profile)
  const promptArg = (generateDossier as jest.Mock).mock.calls[0]
  // chatMessages arg (index 7) should contain the coach_messages row
  expect(JSON.stringify(promptArg[7])).toContain('discussed knee pain')
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest __tests__/lib/synthesize-dossier.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Update lib/claude/synthesize-dossier.ts**

In the `Promise.all` block, replace the two separate reads:

```ts
// Remove these two:
supabase.from('chat_messages')
  .select('role, content')
  .eq('user_id', profile.user_id)
  .order('created_at', { ascending: false })
  .limit(100),
supabase.from('feedback_messages')
  .select('role, content')
  .eq('user_id', profile.user_id)
  .gte('created_at', ninetyDaysAgoTs)
  .order('created_at', { ascending: true })
  .limit(100),
```

```ts
// Add one unified read:
supabase.from('coach_messages')
  .select('role, content, surface')
  .eq('user_id', profile.user_id)
  .gte('created_at', ninetyDaysAgoTs)
  .order('created_at', { ascending: true })
  .limit(200),
```

Update the destructuring:

```ts
const [
  { data: workouts, error: workoutsError },
  { data: feedbacks, error: feedbacksError },
  { data: coachMessages, error: chatError },
  { data: existing },
] = await Promise.all([...])
```

Update the error check: `const readError = workoutsError ?? feedbacksError ?? chatError`

Update the `generateDossier` call — pass `coachMessages` as `chatMessages` and `[]` as `feedbackDiscussions`:

```ts
const content = await generateDossier(
  profile.goals ?? '',
  profile.current_ftp ?? 200,
  profile.weight_kg ?? 70,
  'No inline fitness data — see workout history.',
  ((workouts ?? []) as Array<...>).map(w => ({ ... })),
  (feedbacks ?? []) as import('./dossier').DossierFeedback[],
  eventResults,
  (coachMessages ?? []) as Array<{ role: string; content: string }>,
  [],   // feedbackDiscussions now unified in coachMessages
)
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/lib/synthesize-dossier.test.ts
```

Expected: PASS

- [ ] **Step 5: Run full test suite**

```bash
npx tsc --noEmit && npx jest
```

Expected: no new failures

- [ ] **Step 6: Commit**

```bash
git add lib/claude/synthesize-dossier.ts __tests__/lib/synthesize-dossier.test.ts
git commit -m "feat: dossier synthesis reads from coach_messages unified log

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## PHASE 2 — Nightly digest

---

### Task 10: Migration — coach_conversation_memory table

**Files:**
- Create: `supabase/migrations/20260609_coach_conversation_memory.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Nightly conversation digest: one row per user, upserted by the cron.
create table if not exists coach_conversation_memory (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  digest             text not null default '',
  open_threads       jsonb not null default '[]',
  recurring_concerns jsonb not null default '[]',
  commitments        jsonb not null default '[]',
  synthesized_at     timestamptz not null default now()
);

alter table coach_conversation_memory enable row level security;

create policy "own data" on coach_conversation_memory
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: Apply the migration**

Run in the Supabase SQL editor. Verify the table exists with correct columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260609_coach_conversation_memory.sql
git commit -m "feat: add coach_conversation_memory digest table

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Types — CoachConversationMemory

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add the type after CoachMessage**

```ts
export interface CoachConversationMemory {
  user_id: string
  digest: string
  open_threads: unknown[]
  recurring_concerns: unknown[]
  commitments: unknown[]
  synthesized_at: string
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add CoachConversationMemory type

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 12: synthesize-conversation-memory.ts

**Files:**
- Create: `lib/claude/synthesize-conversation-memory.ts`
- Create: `__tests__/lib/synthesize-conversation-memory.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/synthesize-conversation-memory.test.ts`:

```ts
/** @jest-environment node */
import { synthesizeConversationMemory } from '@/lib/claude/synthesize-conversation-memory'
import { anthropic } from '@/lib/claude/client'

jest.mock('@/lib/claude/client', () => ({
  anthropic: { messages: { create: jest.fn() } },
  MODEL: 'claude-opus-4-8',
}))

function makeSupabase(opts: { messages?: unknown[]; upsertSpy?: jest.Mock }) {
  const b: Record<string, unknown> = {}
  const self = () => b
  Object.assign(b, {
    select: self, eq: self, gte: self, order: self, limit: self,
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: opts.messages ?? [], error: null }),
    upsert: opts.upsertSpy ?? (() => Promise.resolve({ error: null })),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  })
  return { from: () => b }
}

const NOW = '2026-06-09T03:00:00Z'

const fakeDigestJson = JSON.stringify({
  digest: 'Athlete discussed knee pain and fatigue.',
  open_threads: [{ topic: 'knee pain', last_mentioned: '2026-06-08' }],
  recurring_concerns: ['fatigue after long rides'],
  commitments: ['Try easier gear on climbs'],
})

describe('synthesizeConversationMemory', () => {
  beforeEach(() => jest.clearAllMocks())

  it('calls anthropic and upserts the digest', async () => {
    const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
    const supabase = makeSupabase({
      messages: [{ role: 'user', content: 'my knee hurts', surface: 'workout', created_at: '2026-06-08T10:00:00Z' }],
      upsertSpy,
    })
    ;(anthropic.messages.create as jest.Mock).mockResolvedValue({
      content: [{ type: 'text', text: fakeDigestJson }],
    })
    await synthesizeConversationMemory(supabase as never, 'u1', NOW)
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const arg = upsertSpy.mock.calls[0][0]
    expect(arg.user_id).toBe('u1')
    expect(arg.digest).toBe('Athlete discussed knee pain and fatigue.')
    expect(arg.open_threads).toEqual([{ topic: 'knee pain', last_mentioned: '2026-06-08' }])
    expect(arg.commitments).toEqual(['Try easier gear on climbs'])
  })

  it('skips synthesis and upsert when there are no messages', async () => {
    const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
    const supabase = makeSupabase({ messages: [], upsertSpy })
    await synthesizeConversationMemory(supabase as never, 'u1', NOW)
    expect(anthropic.messages.create).not.toHaveBeenCalled()
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('throws on upsert error', async () => {
    const upsertSpy = jest.fn(() => Promise.resolve({ error: { message: 'db fail' } }))
    const supabase = makeSupabase({
      messages: [{ role: 'user', content: 'hello', surface: 'coach', created_at: NOW }],
      upsertSpy,
    })
    ;(anthropic.messages.create as jest.Mock).mockResolvedValue({
      content: [{ type: 'text', text: fakeDigestJson }],
    })
    await expect(synthesizeConversationMemory(supabase as never, 'u1', NOW)).rejects.toThrow('db fail')
  })
})
```

- [ ] **Step 2: Run test — expect import error**

```bash
npx jest __tests__/lib/synthesize-conversation-memory.test.ts 2>&1 | head -5
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Create lib/claude/synthesize-conversation-memory.ts**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { anthropic, MODEL } from './client'

const SYNTHESIS_PROMPT = `You are synthesizing a cycling coach's conversation history with an athlete.
Your task: extract what has been DISCUSSED — not physiology, load, or training compliance (the dossier handles those).

Focus on:
- Open threads: topics raised but not fully resolved (injuries, doubts, planned changes, questions left hanging)
- Recurring concerns: themes the athlete keeps returning to
- Commitments: things the coach or athlete agreed to do or try

Respond with ONLY valid JSON matching this schema — no markdown fences, no explanation:
{
  "digest": "2-3 sentence prose summary of what has been discussed",
  "open_threads": [{"topic": "...", "last_mentioned": "YYYY-MM-DD"}],
  "recurring_concerns": ["..."],
  "commitments": ["..."]
}`

interface DigestResult {
  digest: string
  open_threads: unknown[]
  recurring_concerns: unknown[]
  commitments: unknown[]
}

export async function synthesizeConversationMemory(
  supabase: SupabaseClient,
  userId: string,
  now: string,
): Promise<void> {
  const ninetyDaysAgo = new Date(new Date(now).getTime() - 90 * 864e5).toISOString()

  const { data: rows } = await supabase
    .from('coach_messages')
    .select('role, content, surface, created_at')
    .eq('user_id', userId)
    .gte('created_at', ninetyDaysAgo)
    .order('created_at', { ascending: true })
    .limit(400)

  const messages = (rows ?? []) as { role: string; content: string; surface: string; created_at: string }[]
  if (!messages.length) return

  const transcript = messages
    .map(m => `[${m.surface}, ${m.created_at.split('T')[0]}] ${m.role === 'user' ? 'Athlete' : 'Coach'}: ${m.content}`)
    .join('\n')

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYNTHESIS_PROMPT,
    messages: [{ role: 'user', content: transcript }],
  })

  const raw = (response.content[0] as { type: string; text: string }).text
  const result = JSON.parse(raw) as DigestResult

  const { error } = await supabase.from('coach_conversation_memory').upsert(
    {
      user_id: userId,
      digest: result.digest ?? '',
      open_threads: result.open_threads ?? [],
      recurring_concerns: result.recurring_concerns ?? [],
      commitments: result.commitments ?? [],
      synthesized_at: now,
    },
    { onConflict: 'user_id' },
  )

  if (error) throw new Error(error.message)
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/lib/synthesize-conversation-memory.test.ts
```

Expected: all PASS

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add lib/claude/synthesize-conversation-memory.ts __tests__/lib/synthesize-conversation-memory.test.ts
git commit -m "feat: synthesize-conversation-memory nightly digest

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 13: Extend loadCoachMemory — CONVERSATION MEMORY block

**Files:**
- Modify: `lib/claude/coach-memory.ts`
- Modify: `__tests__/lib/coach-memory.test.ts`

- [ ] **Step 1: Add failing tests**

In `__tests__/lib/coach-memory.test.ts`, add a new helper and describe block at the end:

```ts
function makeSupabaseWithDigest(
  rows: CoachMessage[],
  digest: { digest: string; open_threads: unknown[]; commitments: unknown[] } | null,
) {
  return {
    from: (table: string) => {
      if (table === 'coach_messages') {
        return {
          select: function () { return this },
          eq: function () { return this },
          gte: function () { return this },
          order: function () { return this },
          limit: () => Promise.resolve({ data: rows, error: null }),
        }
      }
      // coach_conversation_memory
      return {
        select: function () { return this },
        eq: function () { return this },
        maybeSingle: () => Promise.resolve({ data: digest, error: null }),
      }
    },
  }
}

describe('loadCoachMemory Phase 2 — digest', () => {
  it('appends CONVERSATION MEMORY block when digest exists', async () => {
    const supabase = makeSupabaseWithDigest([], {
      digest: 'Athlete discussed knee pain.',
      open_threads: [{ topic: 'knee pain', last_mentioned: '2026-06-08' }],
      commitments: ['Try easier gear on climbs'],
    })
    const result = await loadCoachMemory(supabase as never, 'u1', {}, NOW)
    expect(result).toContain('CONVERSATION MEMORY')
    expect(result).toContain('Athlete discussed knee pain.')
    expect(result).toContain('knee pain')
    expect(result).toContain('Try easier gear on climbs')
  })

  it('omits CONVERSATION MEMORY block when no digest row exists', async () => {
    const supabase = makeSupabaseWithDigest([], null)
    const result = await loadCoachMemory(supabase as never, 'u1', {}, NOW)
    expect(result).not.toContain('CONVERSATION MEMORY')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx jest __tests__/lib/coach-memory.test.ts 2>&1 | tail -20
```

Expected: FAIL — `loadCoachMemory` doesn't read the digest yet and the mock structure changed

- [ ] **Step 3: Update lib/claude/coach-memory.ts**

Add `CoachConversationMemory` to the import:
```ts
import type { CoachMessage, CoachConversationMemory } from '@/types'
```

Rewrite `loadCoachMemory` to run both DB queries in parallel and append the CONVERSATION MEMORY block:

```ts
export async function loadCoachMemory(
  supabase: SupabaseClient,
  userId: string,
  opts: LoadMemoryOpts = {},
  now = new Date().toISOString(),
): Promise<string> {
  try {
    const sevenDaysAgo = new Date(new Date(now).getTime() - 7 * 864e5).toISOString()

    const [{ data: rawMessages }, { data: digestRow }] = await Promise.all([
      supabase
        .from('coach_messages')
        .select('id, surface, role, content, context, created_at')
        .eq('user_id', userId)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('coach_conversation_memory')
        .select('digest, open_threads, commitments')
        .eq('user_id', userId)
        .maybeSingle(),
    ])

    const messages = (rawMessages ?? []) as CoachMessage[]

    const filtered = messages
      .filter(m => {
        if (opts.excludeSurface && m.surface === opts.excludeSurface) return false
        if (opts.excludeContextKey && opts.excludeContextValue) {
          const ctx = m.context as Record<string, string> | null
          if (ctx?.[opts.excludeContextKey] === opts.excludeContextValue) return false
        }
        return true
      })
      .slice(0, 25)
      .reverse()

    const parts: string[] = []

    if (filtered.length) {
      const lines = filtered.map(m => {
        const day = relativeDay(m.created_at, now)
        const who = m.role === 'user' ? 'Athlete' : 'Coach'
        return `[${m.surface}, ${day}] ${who}: ${m.content}`
      })
      parts.push(`RECENT CONVERSATIONS (across all your coaching):\n${lines.join('\n')}`)
    }

    const digest = digestRow as CoachConversationMemory | null
    if (digest?.digest) {
      const memLines = [`CONVERSATION MEMORY:`, digest.digest]
      const threads = (digest.open_threads ?? []) as { topic?: string }[]
      if (threads.length) {
        memLines.push(`Open threads: ${threads.map(t => t.topic ?? String(t)).join(', ')}`)
      }
      const commitments = (digest.commitments ?? []) as string[]
      if (commitments.length) {
        memLines.push(`Commitments: ${commitments.join('; ')}`)
      }
      parts.push(memLines.join('\n'))
    }

    return parts.join('\n\n')
  } catch {
    return ''
  }
}
```

- [ ] **Step 4: Update Phase 1 tests that use the old single-query mock**

The existing `makeSupabase` helper in the test file returns a single endpoint for all tables. The new `loadCoachMemory` now queries two tables. Update `makeSupabase` to handle `coach_conversation_memory` (return null by default so Phase 1 tests are unaffected):

```ts
function makeSupabase(rows: Partial<CoachMessage>[], shouldError = false) {
  return {
    from: (table: string) => {
      if (table === 'coach_conversation_memory') {
        return {
          select: function () { return this },
          eq: function () { return this },
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }
      }
      return {
        select: function () { return this },
        eq: function () { return this },
        gte: function () { return this },
        order: function () { return this },
        limit: () =>
          Promise.resolve(
            shouldError
              ? { data: null, error: { message: 'db error' } }
              : { data: rows, error: null },
          ),
      }
    },
  }
}
```

- [ ] **Step 5: Run all coach-memory tests**

```bash
npx jest __tests__/lib/coach-memory.test.ts
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add lib/claude/coach-memory.ts __tests__/lib/coach-memory.test.ts
git commit -m "feat: loadCoachMemory appends CONVERSATION MEMORY digest block

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 14: Wire synthesizeConversationMemory into nightly cron

**Files:**
- Modify: `app/api/cron/dossier/route.ts`

- [ ] **Step 1: Update app/api/cron/dossier/route.ts**

Add import at the top:
```ts
import { synthesizeConversationMemory } from '@/lib/claude/synthesize-conversation-memory'
```

In the per-user `try` block, after the `synthesizeBeliefs` try/catch and before `updated++`, add:

```ts
try {
  await synthesizeConversationMemory(supabase, profile.user_id, runAt.toISOString())
} catch (memErr) {
  console.error(`[cron/dossier] conversation memory failed for user ${profile.user_id}:`, memErr)
  await log(profile.user_id, 'conversation_memory_failed', 'error', { error: String(memErr) })
}
```

The full per-user block now reads:

```ts
try {
  await synthesizeDossier(supabase, { ... })
  try {
    await synthesizeBeliefs(supabase, profile.user_id, runAt.toISOString())
  } catch (beliefErr) {
    console.error(`[cron/dossier] beliefs failed for user ${profile.user_id}:`, beliefErr)
    await log(profile.user_id, 'beliefs_failed', 'error', { error: String(beliefErr) })
  }
  try {
    await synthesizeConversationMemory(supabase, profile.user_id, runAt.toISOString())
  } catch (memErr) {
    console.error(`[cron/dossier] conversation memory failed for user ${profile.user_id}:`, memErr)
    await log(profile.user_id, 'conversation_memory_failed', 'error', { error: String(memErr) })
  }
  updated++
  await log(profile.user_id, 'synthesized', 'ok')
} catch (err) {
  console.error(`[cron/dossier] failed for user ${profile.user_id}:`, err)
  await log(profile.user_id, 'synthesis_failed', 'error', { error: String(err) })
}
```

- [ ] **Step 2: Type check and run full suite**

```bash
npx tsc --noEmit && npx jest
```

Expected: no new failures

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/dossier/route.ts
git commit -m "feat: wire synthesizeConversationMemory into nightly cron

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 15: CLAUDE.md model table update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the model table row**

In `CLAUDE.md`, find the Model Selection table and add the following row:

```
| Conversation memory synthesis (`lib/claude/synthesize-conversation-memory.ts`) | `claude-opus-4-8` |
```

- [ ] **Step 2: Run full test suite one final time**

```bash
npx tsc --noEmit && npx jest
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add conversation memory synthesis to CLAUDE.md model table

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Verification checklist

**After Phase 1:**

1. Say something distinctive in the workout chat (`/api/chat/session`), then open the Coach section (`/api/chat`) → the memory block contains the workout conversation.
2. Verify `coach_messages` in Supabase Table Editor shows rows with `surface='workout'` and `surface='coach'` after chatting on both surfaces.
3. Workout and plan chats now write rows (previously ephemeral); confirm with `select * from coach_messages where surface in ('workout','plan')`.
4. Force a DB error in `loadCoachMemory` (temporarily break the query) → every surface still responds; no error surfaced to the athlete.
5. The live thread is not double-rendered: the current workout session's messages appear once as history, not also in the memory block.

**After Phase 2:**

6. Trigger the dossier cron manually; check `coach_conversation_memory` contains a row with `digest`, `open_threads`, and `commitments` scoped to discussion topics.
7. Subsequent prompts include a CONVERSATION MEMORY block that references discussed topics, not load/compliance numbers.
