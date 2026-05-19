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
        icu_training_load: 85 },
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

  it('createEvent with steps prepends prose description before workout notation', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'evt456' }) })

    await client.createEvent({
      date: '2026-05-15',
      name: 'Threshold Ride',
      description: 'Hard threshold session.\n\nTarget: Zone 4, 88-95% FTP',
      duration_minutes: 60,
      steps: [
        { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 },
        { label: 'Main Set', duration_minutes: 20, power_pct_ftp: 90 },
        { label: 'Cool Down', duration_minutes: 10, power_pct_ftp: 55 },
      ],
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.description).toMatch(/Hard threshold session/)
    expect(body.description).toMatch(/Target: Zone 4/)
    expect(body.description).toMatch(/---/)
    expect(body.description).toMatch(/Warm Up/)
    // Prose appears before the separator
    expect(body.description.indexOf('Hard threshold')).toBeLessThan(body.description.indexOf('---'))
  })

  it('getEvents returns ICUEvent array and calls correct URL', async () => {
    const mockEvents = [
      { id: 'evt1', category: 'RACE', name: 'Dragon Ride', start_date_local: '2026-09-14T00:00:00' },
      { id: 'evt2', category: 'WORKOUT', name: 'Threshold Session', start_date_local: '2026-05-20T08:00:00' },
    ]
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockEvents })

    const events = await client.getEvents('2026-05-12', '2026-11-12')

    expect(events).toHaveLength(2)
    expect(events[0].category).toBe('RACE')
    expect(events[0].id).toBe('evt1')
    expect(events[0].name).toBe('Dragon Ride')
    expect(events[0].start_date_local).toBe('2026-09-14T00:00:00')
    expect(events[1].category).toBe('WORKOUT')
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('/athlete/i12345/events?oldest=2026-05-12&newest=2026-11-12')
  })

  it('getPowerCurve returns power curve array and calls correct URL', async () => {
    const mockCurve = [
      { secs: 300, watts: 380 },
      { secs: 1200, watts: 320 },
      { secs: 3600, watts: 275 },
    ]
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockCurve })

    const curve = await client.getPowerCurve('2026-02-15', '2026-05-15')

    expect(curve).toHaveLength(3)
    expect(curve[0].secs).toBe(300)
    expect(curve[0].watts).toBe(380)
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('/athlete/i12345/power_curves?type=Ride&oldest=2026-02-15&newest=2026-05-15')
  })

  it('updateEvent sets start_date_local when date is provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    await client.updateEvent('evt123', { date: '2026-05-22' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.start_date_local).toBe('2026-05-22T08:00:00')
    expect(mockFetch.mock.calls[0][0]).toContain('/athlete/i12345/events/evt123')
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT')
  })

  it('updateEvent omits start_date_local when date is not provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    await client.updateEvent('evt123', { name: 'New Name' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.start_date_local).toBeUndefined()
    expect(body.name).toBe('New Name')
  })
})
