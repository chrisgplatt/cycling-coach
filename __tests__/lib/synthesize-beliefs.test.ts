import { synthesizeBeliefs } from '@/lib/claude/synthesize-beliefs'

// Minimal Supabase fake: records upserts and returns canned rows per table.
function fakeSupabase(opts: {
  workouts: unknown[]; feedback: unknown[]; beliefs: unknown[]
  onUpsert?: (rows: unknown[]) => void
  upsertError?: string
}) {
  return {
    from(table: string) {
      if (table === 'athlete_beliefs') {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: opts.beliefs }) }),
          upsert: (rows: unknown[]) => { opts.onUpsert?.(rows); return Promise.resolve({ error: opts.upsertError ? { message: opts.upsertError } : null }) },
        }
      }
      const data = table === 'workouts' ? opts.workouts : opts.feedback
      const qb: Record<string, unknown> = {}
      ;['select', 'eq', 'gte', 'order'].forEach(m => { qb[m] = () => qb })
      ;(qb as { then: unknown }).then = (res: (v: { data: unknown[] }) => unknown) => res({ data })
      return qb
    },
  } as unknown as Parameters<typeof synthesizeBeliefs>[0]
}

const NOW = '2026-06-05T03:00:00Z'

it('assembles, builds, reconciles and upserts a new ramp-tolerance belief', async () => {
  let upserted: unknown[] = []
  const workouts = [
    { id: 'w1', date: '2026-05-04', type: 'endurance', tss: 300, status: 'completed' },
    { id: 'w2', date: '2026-05-11', type: 'endurance', tss: 330, status: 'completed' },
    { id: 'w3', date: '2026-05-18', type: 'endurance', tss: 363, status: 'completed' },
    { id: 'w4', date: '2026-05-25', type: 'endurance', tss: 399, status: 'completed' },
  ]
  const supabase = fakeSupabase({ workouts, feedback: [], beliefs: [], onUpsert: r => { upserted = r } })

  await synthesizeBeliefs(supabase, 'u1', NOW)

  const keys = upserted.map(r => (r as { key: string }).key)
  expect(keys).toContain('ramp_tolerance')
  expect(upserted.every(r => (r as { user_id: string }).user_id === 'u1')).toBe(true)
})

it('writes nothing when there is not enough data for any belief', async () => {
  let upserted: unknown[] | null = null
  const supabase = fakeSupabase({ workouts: [], feedback: [], beliefs: [], onUpsert: r => { upserted = r } })
  await synthesizeBeliefs(supabase, 'u1', NOW)
  expect(upserted).toBeNull()
})

it('throws when a read fails', async () => {
  const supabase = {
    from: () => {
      const qb: Record<string, unknown> = {}
      ;['select', 'eq', 'gte', 'order'].forEach(m => { qb[m] = () => qb })
      ;(qb as { then: unknown }).then = (res: (v: unknown) => unknown) =>
        res({ data: null, error: { message: 'forbidden' } })
      return qb
    },
  } as unknown as Parameters<typeof synthesizeBeliefs>[0]
  await expect(synthesizeBeliefs(supabase, 'u1', NOW)).rejects.toThrow(/read failed/)
})

it('throws when the upsert fails', async () => {
  const workouts = [
    { id: 'w1', date: '2026-05-04', type: 'endurance', tss: 300, status: 'completed' },
    { id: 'w2', date: '2026-05-11', type: 'endurance', tss: 330, status: 'completed' },
    { id: 'w3', date: '2026-05-18', type: 'endurance', tss: 363, status: 'completed' },
    { id: 'w4', date: '2026-05-25', type: 'endurance', tss: 399, status: 'completed' },
  ]
  const supabase = fakeSupabase({ workouts, feedback: [], beliefs: [], upsertError: 'constraint violation' })
  await expect(synthesizeBeliefs(supabase, 'u1', NOW)).rejects.toThrow(/upsert failed/)
})
