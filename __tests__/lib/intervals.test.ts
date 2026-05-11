import { IntervalsClient } from '@/lib/intervals/client'

const mockFetch = jest.fn()
global.fetch = mockFetch

const client = new IntervalsClient('i12345', 'test-api-key')

beforeEach(() => mockFetch.mockReset())

describe('IntervalsClient', () => {
  it('uses correct Basic auth header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ftp: 250, weight: 72 }),
    })

    await client.getAthlete()

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://intervals.icu/api/v1/athlete/i12345')
    const expected = 'Basic ' + Buffer.from('API_KEY:test-api-key').toString('base64')
    expect(options.headers.Authorization).toBe(expected)
  })

  it('getActivities returns ICUActivity array', async () => {
    const mockActivities = [
      { id: 'act1', start_date_local: '2026-05-01T08:00:00', type: 'Ride',
        moving_time: 3600, name: 'Morning Ride', average_watts: 200,
        max_watts: 350, weighted_average_watts: 210, average_heartrate: 145,
        training_load: 85 },
    ]
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockActivities })

    const activities = await client.getActivities('2026-04-01', '2026-05-11')
    expect(activities).toHaveLength(1)
    expect(activities[0].id).toBe('act1')
    expect(activities[0].training_load).toBe(85)
  })

  it('createEvent returns the created event id', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'evt123' }) })

    const id = await client.createEvent({
      date: '2026-05-15',
      name: 'Endurance Ride',
      description: 'Zone 2 for 90 mins',
      duration_minutes: 90,
    })
    expect(id).toBe('evt123')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Forbidden' })
    await expect(client.getAthlete()).rejects.toThrow('intervals.icu API error 403')
  })
})
