/** @jest-environment node */
import { makeDb } from '../support/gear-fake-db'

jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { GET } from '@/app/api/rides/activity/[activityId]/bike/route'

const use = (db: ReturnType<typeof makeDb>) => (createSupabaseServerClient as jest.Mock).mockResolvedValue(db.client)
const ctx = (activityId: string) => ({ params: Promise.resolve({ activityId }) })
const req = () => new Request('http://t/api')

describe('GET /api/rides/activity/[activityId]/bike', () => {
  it('401s without a user', async () => {
    use(makeDb({}, { userId: null }))
    expect((await GET(req(), ctx('a1'))).status).toBe(401)
  })
  it('returns the workout id and current bike for the activity', async () => {
    use(makeDb({ workouts: [{ id: 'w1', user_id: 'u1', icu_activity_id: 'a1', bike_id: 'b1' }] }))
    expect(await (await GET(req(), ctx('a1'))).json()).toEqual({ workoutId: 'w1', bikeId: 'b1' })
  })
  it('returns a null bike for an unassigned ride', async () => {
    use(makeDb({ workouts: [{ id: 'w1', user_id: 'u1', icu_activity_id: 'a1', bike_id: null }] }))
    expect((await (await GET(req(), ctx('a1'))).json()).bikeId).toBeNull()
  })
  it('404s when the activity has no workout of the user’s', async () => {
    use(makeDb({ workouts: [{ id: 'w2', user_id: 'other', icu_activity_id: 'a1', bike_id: null }] }))
    expect((await GET(req(), ctx('a1'))).status).toBe(404)
  })
})
