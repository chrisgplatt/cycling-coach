import { IntervalsClient } from '@/lib/intervals/client'

function mockFetch() {
  const fn = jest.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({}), text: async () => '',
  })
  global.fetch = fn as unknown as typeof fetch
  return fn
}

describe('IntervalsClient.updateActivityFeel', () => {
  it('PUTs icu_rpe and feel directly to the activity endpoint', async () => {
    const fetchFn = mockFetch()
    const client = new IntervalsClient('123', 'key')
    await client.updateActivityFeel('a1', { rpe: 7, feel: 2 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchFn.mock.calls[0]
    expect(url).toBe('https://intervals.icu/api/v1/activity/a1')
    expect(opts.method).toBe('PUT')
    // our feel 2 (Good) maps straight to intervals.icu feel 2 (Good) — same scale
    expect(JSON.parse(opts.body)).toEqual({ icu_rpe: 7, feel: 2 })
  })

  it('sends only the fields provided', async () => {
    const fetchFn = mockFetch()
    const client = new IntervalsClient('123', 'key')
    await client.updateActivityFeel('a1', { rpe: 5, feel: null })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ icu_rpe: 5 })
  })

  it('makes no request when neither value is provided', async () => {
    const fetchFn = mockFetch()
    const client = new IntervalsClient('123', 'key')
    await client.updateActivityFeel('a1', { rpe: null, feel: null })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
