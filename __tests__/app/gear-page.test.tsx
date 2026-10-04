import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import GearPage from '@/app/settings/gear/page'

jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }))

type Json = Record<string, unknown>
const trigger = (o: Json = {}) => ({
  id: 't1', user_id: 'u', component_id: 'c1', label: 'Re-wax', kind: 'recurring', metric: 'km', interval_value: 300,
  last_done_at: null, heads_up_notified_at: null, due_notified_at: null,
  progress: { used: 212, interval: 300, fraction: 0.71, status: 'ok' }, ...o,
})
const chain = (o: Json = {}) => ({
  id: 'c1', user_id: 'u', bike_id: 'b1', name: 'KMC chain', category: 'chain', installed_at: '2026-01-01', retired_at: null,
  usage: { km: 212, hours: 9 },
  triggers: [trigger(), trigger({ id: 't2', label: 'Replace chain', kind: 'lifetime', interval_value: 4000, progress: { used: 212, interval: 4000, fraction: 0.05, status: 'ok' } })],
  ...o,
})
const bike = (o: Json = {}) => ({
  id: 'b1', user_id: 'u', name: 'Tarmac', kind: 'road', is_default: true, is_indoor_default: false, retired_at: null,
  totals: { km: 1234.5, hours: 50 }, components: [chain()], ...o,
})

interface Call { url: string; method: string; body: Json | null }
function mockApi(bikes: unknown[], extra: Record<string, unknown> = {}) {
  const calls: Call[] = []
  global.fetch = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url, method, body })
    if (url === '/api/gear' && method === 'GET') return { ok: true, json: async () => ({ bikes }) }
    const key = `${method} ${url}`
    return { ok: true, json: async () => (extra[key] ?? { ok: true }) }
  }) as never
  return calls
}
const find = (calls: Call[], method: string, url: string) => calls.find(c => c.method === method && c.url === url)

beforeEach(() => { jest.spyOn(window, 'confirm').mockReturnValue(true) })

describe('/settings/gear', () => {
  it('shows an empty state with an Add bike button', async () => {
    mockApi([])
    render(<GearPage />)
    expect(await screen.findByText('No bikes yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add bike' })).toBeInTheDocument()
  })

  it('lists bikes with badges and lifetime totals', async () => {
    mockApi([bike(), bike({ id: 'b2', name: 'Trainer bike', kind: 'trainer', is_default: false, is_indoor_default: true, totals: { km: 10, hours: 1 }, components: [] })])
    render(<GearPage />)
    const card = await screen.findByRole('button', { name: /Tarmac/ })
    expect(within(card).getByText('Default')).toBeInTheDocument()
    expect(card).toHaveTextContent('1234.5 km')
    expect(screen.getByRole('button', { name: /Trainer bike/ })).toHaveTextContent('Trainer')
  })

  it('adds a bike, then offers to assign existing rides', async () => {
    const calls = mockApi([], { 'POST /api/gear/bikes': { bike: { id: 'new', name: 'Tarmac' }, unassignedRideCount: 3 } })
    render(<GearPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add bike' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tarmac' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Assign your 3 existing rides to Tarmac\?/)).toBeInTheDocument()
    expect(find(calls, 'POST', '/api/gear/bikes')!.body).toEqual({ name: 'Tarmac', kind: 'road' })
    fireEvent.click(screen.getByRole('button', { name: 'Assign rides' }))
    await waitFor(() => expect(find(calls, 'POST', '/api/gear/backfill')).toBeTruthy())
    expect(find(calls, 'POST', '/api/gear/backfill')!.body).toEqual({})
    await waitFor(() => expect(screen.queryByText(/existing rides/)).not.toBeInTheDocument())
  })

  it('skips the backfill prompt without calling the API', async () => {
    const calls = mockApi([], { 'POST /api/gear/bikes': { bike: { id: 'new', name: 'Tarmac' }, unassignedRideCount: 2 } })
    render(<GearPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add bike' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tarmac' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))
    expect(find(calls, 'POST', '/api/gear/backfill')).toBeUndefined()
  })

  it('shows a bike’s components with trigger progress', async () => {
    mockApi([bike()])
    render(<GearPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Tarmac/ }))
    expect(screen.getByText('KMC chain')).toBeInTheDocument()
    expect(screen.getByText('212 / 300 km')).toBeInTheDocument()
    expect(screen.getByText('212 / 4000 km')).toBeInTheDocument()
    expect(screen.getByText('Lifetime limit')).toBeInTheDocument()
  })

  it('offers Mark done only for recurring triggers and posts the chosen date', async () => {
    const calls = mockApi([bike()])
    render(<GearPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Tarmac/ }))
    expect(screen.getAllByRole('button', { name: 'Mark done' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-03-10' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(find(calls, 'POST', '/api/gear/triggers/t1/done')).toBeTruthy())
    expect(find(calls, 'POST', '/api/gear/triggers/t1/done')!.body).toEqual({ date: '2026-03-10' })
  })

  it('replaces a component', async () => {
    const calls = mockApi([bike()])
    render(<GearPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Tarmac/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Fitted on'), { target: { value: '2026-05-01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace component' }))
    await waitFor(() => expect(find(calls, 'POST', '/api/gear/components/c1/replace')).toBeTruthy())
    expect(find(calls, 'POST', '/api/gear/components/c1/replace')!.body).toEqual({ name: 'KMC chain', installed_at: '2026-05-01' })
  })

  it('adds a chain with the preset triggers', async () => {
    const calls = mockApi([bike({ components: [] })])
    render(<GearPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Tarmac/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'New chain' } })
    expect(within(dialog).getByLabelText('Re-wax')).toBeChecked()
    expect(within(dialog).getByLabelText('Replace chain')).toBeChecked()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(find(calls, 'POST', '/api/gear/components')).toBeTruthy())
    const body = find(calls, 'POST', '/api/gear/components')!.body as { bike_id: string; category: string; triggers: unknown[] }
    expect(body).toMatchObject({ bike_id: 'b1', name: 'New chain', category: 'chain' })
    expect(body.triggers).toEqual([
      { label: 'Re-wax', kind: 'recurring', metric: 'km', interval_value: 300 },
      { label: 'Replace chain', kind: 'lifetime', metric: 'km', interval_value: 4000 },
    ])
  })

  it('sets the default bike and trainer bike from the detail view', async () => {
    const calls = mockApi([bike(), bike({ id: 'b2', name: 'Gravel', is_default: false, totals: { km: 5, hours: 1 }, components: [] })])
    render(<GearPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Gravel/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Set as default' }))
    await waitFor(() => expect(find(calls, 'PATCH', '/api/gear/bikes/b2')).toBeTruthy())
    expect(find(calls, 'PATCH', '/api/gear/bikes/b2')!.body).toEqual({ is_default: true })
    // actions are disabled while a request is in flight
    await waitFor(() => expect(screen.getByRole('button', { name: 'Set as trainer bike' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Set as trainer bike' }))
    await waitFor(() => expect(calls.filter(c => c.method === 'PATCH' && c.url === '/api/gear/bikes/b2')).toHaveLength(2))
    expect(calls.filter(c => c.method === 'PATCH').pop()!.body).toEqual({ is_indoor_default: true })
  })

  it('shows API errors from an action', async () => {
    mockApi([bike()])
    render(<GearPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Tarmac/ }))
    ;(global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: false, json: async () => ({ error: 'date cannot be in the future' }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('date cannot be in the future')).toBeInTheDocument()
  })
})
