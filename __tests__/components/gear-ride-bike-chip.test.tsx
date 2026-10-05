import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RideBikeChip from '@/components/gear/RideBikeChip'

const bike = (o: Record<string, unknown>) => ({
  user_id: 'u', kind: 'road', is_default: false, is_indoor_default: false, retired_at: null,
  totals: { km: 0, hours: 0 }, components: [], ...o,
})
const road = bike({ id: 'road', name: 'Road', is_default: true })
const trainer = bike({ id: 'trainer', name: 'Trainer', kind: 'trainer', is_indoor_default: true })
const gravel = bike({ id: 'gravel', name: 'Gravel' })
const retired = bike({ id: 'old', name: 'Old', retired_at: '2026-01-01T00:00:00Z' })

function mockFetch(opts: { bikes: unknown[]; bikeId: string | null; workout?: boolean }) {
  const calls: Array<{ url: string; method?: string; body?: string }> = []
  global.fetch = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method, body: init?.body })
    if (url === '/api/gear') return { ok: true, json: async () => ({ bikes: opts.bikes }) }
    if (url.endsWith('/bike') && (!init?.method || init.method === 'GET')) {
      return opts.workout === false
        ? { ok: false, json: async () => ({ error: 'nope' }) }
        : { ok: true, json: async () => ({ workoutId: 'w1', bikeId: opts.bikeId }) }
    }
    return { ok: true, json: async () => ({ ok: true }) }
  }) as never
  return calls
}

describe('RideBikeChip', () => {
  it('shows the ride’s current bike', async () => {
    mockFetch({ bikes: [road, trainer], bikeId: 'road' })
    render(<RideBikeChip activityId="a1" isIndoor={false} />)
    expect(await screen.findByRole('button', { name: /Bike: Road/ })).toBeInTheDocument()
  })

  it('renders nothing when the user has no bikes', async () => {
    mockFetch({ bikes: [], bikeId: null })
    const { container } = render(<RideBikeChip activityId="a1" isIndoor={false} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the activity has no workout row', async () => {
    mockFetch({ bikes: [road], bikeId: null, workout: false })
    const { container } = render(<RideBikeChip activityId="a1" isIndoor={false} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(container).toBeEmptyDOMElement()
  })

  it('offers only non-retired bikes and saves the override', async () => {
    const calls = mockFetch({ bikes: [road, gravel, retired], bikeId: 'road' })
    render(<RideBikeChip activityId="a1" isIndoor={false} />)
    fireEvent.click(await screen.findByRole('button', { name: /Bike: Road/ }))
    expect(screen.queryByRole('button', { name: 'Old' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Gravel' }))
    await screen.findByRole('button', { name: /Bike: Gravel/ })
    const patch = calls.find(c => c.method === 'PATCH')!
    expect(patch.url).toBe('/api/workouts/w1/bike')
    expect(JSON.parse(patch.body!)).toEqual({ bike_id: 'gravel' })
  })

  it('"Reset to default" picks the trainer bike for indoor rides and the default otherwise', async () => {
    const calls = mockFetch({ bikes: [road, trainer, gravel], bikeId: 'gravel' })
    const { unmount } = render(<RideBikeChip activityId="a1" isIndoor />)
    fireEvent.click(await screen.findByRole('button', { name: /Bike: Gravel/ }))
    fireEvent.click(screen.getByRole('button', { name: /Reset to default/ }))
    await screen.findByRole('button', { name: /Bike: Trainer/ })
    expect(JSON.parse(calls.find(c => c.method === 'PATCH')!.body!)).toEqual({ bike_id: 'trainer' })
    unmount()

    const calls2 = mockFetch({ bikes: [road, trainer, gravel], bikeId: 'gravel' })
    render(<RideBikeChip activityId="a1" isIndoor={false} />)
    fireEvent.click(await screen.findByRole('button', { name: /Bike: Gravel/ }))
    fireEvent.click(screen.getByRole('button', { name: /Reset to default/ }))
    await screen.findByRole('button', { name: /Bike: Road/ })
    expect(JSON.parse(calls2.find(c => c.method === 'PATCH')!.body!)).toEqual({ bike_id: 'road' })
  })

  it('shows an error and keeps the old bike if saving fails', async () => {
    mockFetch({ bikes: [road, gravel], bikeId: 'road' })
    render(<RideBikeChip activityId="a1" isIndoor={false} />)
    fireEvent.click(await screen.findByRole('button', { name: /Bike: Road/ }))
    ;(global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: false, json: async () => ({ error: 'Cannot assign a retired bike' }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Gravel' }))
    expect(await screen.findByText('Cannot assign a retired bike')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bike: Road/ })).toBeInTheDocument()
  })
})

describe('RideBikeChip row design', () => {
  it('shows the bike name with a visible "Change" affordance', async () => {
    mockFetch({ bikes: [road, gravel], bikeId: 'road' })
    render(<RideBikeChip activityId="a1" isIndoor={false} />)
    const row = await screen.findByRole('button', { name: /Bike: Road/ })
    expect(row).toHaveTextContent('Road')
    expect(row).toHaveTextContent('Change')
    expect(row.className).toContain('w-full')
  })

  it('prompts to choose a bike when the ride has none', async () => {
    mockFetch({ bikes: [road], bikeId: null })
    render(<RideBikeChip activityId="a1" isIndoor={false} />)
    const row = await screen.findByRole('button', { name: /Bike: None/ })
    expect(row).toHaveTextContent('No bike')
    expect(row).toHaveTextContent('Choose')
  })

  it('truncates long bike names instead of overflowing', async () => {
    const long = bike({ id: 'long', name: 'Specialized S-Works Tarmac SL8 Dura-Ace Di2 Limited Edition', is_default: true })
    mockFetch({ bikes: [long], bikeId: 'long' })
    render(<RideBikeChip activityId="a1" isIndoor={false} />)
    const row = await screen.findByRole('button', { name: /Bike: Specialized/ })
    expect(row.querySelector('.truncate')).toHaveTextContent('Specialized S-Works Tarmac SL8')
  })
})
