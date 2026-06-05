import { IntervalsClient, buildWorkoutNotation } from '@/lib/intervals/client'
import type { WorkoutStep } from '@/types'

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

  it('createEvent prepends a coach note above the prose and notation', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'evtN' }) })

    await client.createEvent({
      date: '2026-05-15',
      name: 'Threshold',
      description: 'Target: Zone 4',
      duration_minutes: 60,
      note: 'Settle into a strong, smooth rhythm and hold it steady.',
      steps: [{ label: 'Main Set', duration_minutes: 40, power_pct_ftp: 95 }],
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.description.startsWith('Settle into a strong, smooth rhythm and hold it steady.')).toBe(true)
    // note sits above both the prose and the step notation
    expect(body.description.indexOf('Settle')).toBeLessThan(body.description.indexOf('Target: Zone 4'))
    expect(body.description.indexOf('Target: Zone 4')).toBeLessThan(body.description.indexOf('---'))
  })

  it('createEvent truncates a coach note longer than 200 chars on a word boundary', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'evtN2' }) })

    const long = ('alpha bravo charlie delta echo foxtrot golf hotel '.repeat(6)).trim() // ~294 chars
    await client.createEvent({
      date: '2026-05-15', name: 'X', description: 'Prose body', duration_minutes: 30, note: long,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    const firstBlock = body.description.split('\n\n')[0]
    expect(firstBlock.length).toBeLessThanOrEqual(200)
    expect(firstBlock.endsWith('…')).toBe(true)
    // cut fell on a word boundary: the kept text is a whole-word prefix of the note
    expect(long.startsWith(firstBlock.slice(0, -1))).toBe(true)
  })

  it('createEvent omits the note block when no note is given', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'evtN3' }) })
    await client.createEvent({ date: '2026-05-15', name: 'X', description: 'Prose body', duration_minutes: 30 })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.description).toBe('Prose body')
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
    const mockResponse = {
      after_kj: 0,
      secs: [300, 600, 1200],
      curves: [
        { id: 'act1', watts: [380, 340, 310] },
        { id: 'act2', watts: [360, 355, 320] },
      ],
    }
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockResponse })

    const curve = await client.getPowerCurve('2026-02-15', '2026-05-15')

    expect(curve).toHaveLength(3)
    expect(curve[0]).toEqual({ secs: 300, watts: 380 })  // max(380, 360)
    expect(curve[1]).toEqual({ secs: 600, watts: 355 })  // max(340, 355)
    expect(curve[2]).toEqual({ secs: 1200, watts: 320 }) // max(310, 320)
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('/athlete/i12345/activity-power-curves.json?type=Ride&oldest=2026-02-15&newest=2026-05-15')
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

  it('getActivity maps a single activity by id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'act9', start_date_local: '2026-05-20T07:00:00', type: 'Ride',
        moving_time: 5400, name: 'Long Z2', icu_average_watts: 180,
        icu_weighted_avg_watts: 195, total_elevation_gain: 420, icu_training_load: 110,
      }),
    })

    const a = await client.getActivity('act9')

    expect(a.id).toBe('act9')
    expect(a.weighted_average_watts).toBe(195)
    expect(a.total_elevation_gain).toBe(420)
    expect(mockFetch.mock.calls[0][0]).toBe('https://intervals.icu/api/v1/activity/act9')
  })

  it('getActivityIntervals maps icu_intervals to ActivityInterval[]', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        icu_intervals: [
          { label: 'Warm Up', elapsed_time: 600, average_watts: 140, average_heartrate: 118 },
          { label: 'Work', elapsed_time: 480, average_watts: 248, average_heartrate: 161 },
        ],
      }),
    })

    const ivs = await client.getActivityIntervals('act9')

    expect(ivs).toHaveLength(2)
    expect(ivs[1]).toEqual({ label: 'Work', duration_secs: 480, avg_watts: 248, avg_hr: 161 })
    expect(mockFetch.mock.calls[0][0]).toBe('https://intervals.icu/api/v1/activity/act9?intervals=true')
  })

  it('getActivityIntervals returns [] on a malformed payload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ unexpected: true }) })
    const ivs = await client.getActivityIntervals('act9')
    expect(ivs).toEqual([])
  })

  it('createEvent gates the warm-up and every recovery before a hard effort', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'evt789' }) })

    await client.createEvent({
      date: '2026-05-15',
      name: 'VO2 Session',
      description: '3x3min VO2',
      duration_minutes: 60,
      steps: [
        { label: 'Warm Up', duration_minutes: 12, power_pct_ftp: 60 },
        { label: 'Work', duration_minutes: 3, power_pct_ftp: 115 },
        { label: 'Recovery', duration_minutes: 3, power_pct_ftp: 50 },
        { label: 'Work', duration_minutes: 3, power_pct_ftp: 115 },
        { label: 'Recovery', duration_minutes: 3, power_pct_ftp: 50 },
        { label: 'Work', duration_minutes: 3, power_pct_ftp: 115 },
        { label: 'Cool Down', duration_minutes: 10, power_pct_ftp: 55 },
      ],
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    // Warm-up runs its time, then a lap gate holds until the rider presses lap
    expect(body.description).toContain('Warm Up\n- 12m 60%\n- 10s 60% press lap')
    // Each recovery before a hard effort is its OWN block ending in a lap gate —
    // the same proven two-line shape as the warm-up (a gate buried after the work
    // leg in one multi-step block advances unreliably on head units).
    expect(body.description).toContain('Work\n- 3m 115%')
    expect(body.description).toContain('Recovery\n- 3m 50%\n- 10s 50% press lap')
    expect(body.description).not.toContain('Main Set')
    // The work leg never gets a lap gate
    expect(body.description).not.toContain('115% press lap')
    // warm-up + both inter-effort recoveries
    expect((body.description.match(/press lap/g) ?? []).length).toBe(3)
    // Cool down stays timed
    expect(body.description).toContain('Cool Down\n- 10m 55%')
    expect(body.description).not.toContain('55% press lap')
  })

  it('getActivityStreams calls the streams endpoint and normalises channels', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { type: 'time', data: [0, 1] },
        { type: 'watts', data: [100, 200] },
        { type: 'latlng', data: [[53.5, -2.4], [53.6, -2.5]] },
      ]),
    })
    const s = await client.getActivityStreams('act9')
    expect(s.power).toEqual([100, 200])
    expect(s.latlng).toEqual([[53.5, -2.4], [53.6, -2.5]])
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://intervals.icu/api/v1/activity/act9/streams?types=time,latlng,watts,heartrate,altitude,distance,cadence,velocity_smooth'
    )
  })
})

describe('buildWorkoutNotation press-lap tagging', () => {
  it('does not tag any step of a steady endurance ride', () => {
    const steps: WorkoutStep[] = [
      { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 55 },
      { label: 'Endurance', duration_minutes: 60, power_pct_ftp: 68 },
      { label: 'Cool Down', duration_minutes: 10, power_pct_ftp: 50 },
    ]
    const out = buildWorkoutNotation(steps)
    // Only the warm-up gets a lap gate; the easy main block is not a work/recovery set
    expect(out).toContain('Warm Up\n- 10m 55%\n- 10s 55% press lap')
    expect(out).not.toContain('68% press lap')
  })

  it('gives each recovery before a hard effort its own standalone gated block', () => {
    const steps: WorkoutStep[] = [
      { label: 'Warm Up', duration_minutes: 12, power_pct_ftp: 60 },
      { label: 'Work', duration_minutes: 3, power_pct_ftp: 120 },
      { label: 'Recovery', duration_minutes: 3, power_pct_ftp: 50 },
      { label: 'Work', duration_minutes: 3, power_pct_ftp: 120 },
      { label: 'Recovery', duration_minutes: 3, power_pct_ftp: 50 },
      { label: 'Work', duration_minutes: 3, power_pct_ftp: 120 },
      { label: 'Recovery', duration_minutes: 3, power_pct_ftp: 50 },
      { label: 'Work', duration_minutes: 3, power_pct_ftp: 120 },
      { label: 'Cool Down', duration_minutes: 10, power_pct_ftp: 55 },
    ]
    const out = buildWorkoutNotation(steps)
    // Effort and recovery are separate blocks; the recovery block matches the
    // proven warm-up shape (one timed step then the gate), not a 3-line block.
    expect(out).not.toContain('Main Set')
    expect(out).toContain('Work\n- 3m 120%')
    expect(out).toContain('Recovery\n- 3m 50%\n- 10s 50% press lap')
    // warm-up + 3 recoveries (each of the three recoveries precedes a hard effort)
    expect((out.match(/press lap/g) ?? []).length).toBe(4)
    // The work leg itself is never gated
    expect(out).not.toContain('120% press lap')
  })

  it('still gates recoveries when AI-generated reps vary slightly (the bug)', () => {
    // Reps differ by a watt or a minute — the old exact-repeat detection failed
    // here and dropped every recovery gate, so the head unit rolled straight from
    // recovery into the next interval.
    const steps: WorkoutStep[] = [
      { label: 'Warm Up', duration_minutes: 12, power_pct_ftp: 60 },
      { label: 'Work', duration_minutes: 5, power_pct_ftp: 106 },
      { label: 'Recovery', duration_minutes: 4, power_pct_ftp: 50 },
      { label: 'Work', duration_minutes: 5, power_pct_ftp: 104 },
      { label: 'Recovery', duration_minutes: 3, power_pct_ftp: 50 },
      { label: 'Work', duration_minutes: 4, power_pct_ftp: 105 },
      { label: 'Cool Down', duration_minutes: 10, power_pct_ftp: 55 },
    ]
    const out = buildWorkoutNotation(steps)
    expect(out).toContain('Recovery\n- 4m 50%\n- 10s 50% press lap')
    expect(out).toContain('Recovery\n- 3m 50%\n- 10s 50% press lap')
    expect(out).toContain('Work\n- 5m 106%')
    expect(out).toContain('Work\n- 5m 104%')
    // warm-up + both inter-effort recoveries — not just the warm-up
    expect((out.match(/press lap/g) ?? []).length).toBe(3)
    expect(out).not.toContain('106% press lap')
  })

  it('does not tag the second leg of an over/under set (recovery leg is harder)', () => {
    const steps: WorkoutStep[] = [
      { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 },
      { label: 'Under', duration_minutes: 2, power_pct_ftp: 95 },
      { label: 'Over', duration_minutes: 1, power_pct_ftp: 110 },
      { label: 'Under', duration_minutes: 2, power_pct_ftp: 95 },
      { label: 'Over', duration_minutes: 1, power_pct_ftp: 110 },
      { label: 'Cool Down', duration_minutes: 10, power_pct_ftp: 50 },
    ]
    const out = buildWorkoutNotation(steps)
    // The "over" leg is harder than the "under" leg, so it is not treated as recovery
    expect(out).not.toContain('110% press lap')
    expect(out).toContain('Main Set 2x\n- 2m 95%\n- 1m 110%')
  })
})
