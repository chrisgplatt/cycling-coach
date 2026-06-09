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
