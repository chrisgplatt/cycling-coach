import { render, screen, waitFor } from '@testing-library/react'
import ProgressStats from '@/components/ProgressStats'

const mockFetch = jest.fn()
global.fetch = mockFetch

const briefData = {
  content: 'Your CTL has grown 15 points since starting this plan.',
  metrics_snapshot: {
    ftp: { current: 245, baseline: 230, delta: 15 },
    ctl: { current: 70, baseline: 55, delta: 15 },
    weight: { current: 73.5, baseline: 75.0, delta: -1.5 },
    adherence: { completed: 14, total: 16 },
    streak: 5,
    totalRides: 47,
    planPhase: 'build',
    targetEvent: 'Dragon Ride',
    targetDate: '2026-09-01',
    planStartDate: '2026-04-01',
  },
  generated_at: new Date(Date.now() - 600000).toISOString(),
}

beforeEach(() => mockFetch.mockReset())

describe('ProgressStats', () => {
  it('renders FTP tile with positive delta', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('245W')).toBeInTheDocument()
    expect(await screen.findByText('+15W')).toBeInTheDocument()
  })

  it('renders fitness (CTL) tile', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('70')).toBeInTheDocument()
    expect(await screen.findByText('+15pts')).toBeInTheDocument()
  })

  it('renders sessions adherence tile', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('14/16')).toBeInTheDocument()
    expect(await screen.findByText('88%')).toBeInTheDocument()
  })

  it('renders streak tile', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('🔥 5')).toBeInTheDocument()
  })

  it('renders rides tile', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('47')).toBeInTheDocument()
  })

  it('renders weight tile with negative delta (green)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('73.5kg')).toBeInTheDocument()
    expect(await screen.findByText('-1.5')).toBeInTheDocument()
  })

  it('does not render the coaching narrative text', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    await screen.findByText('245W') // wait for data to load
    expect(screen.queryByText(/CTL has grown 15 points/)).not.toBeInTheDocument()
  })

  it('renders nothing when API returns null', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => null })
    const { container } = render(<ProgressStats syncVersion={0} />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('re-fetches when syncVersion changes', async () => {
    const updated = { ...briefData, metrics_snapshot: { ...briefData.metrics_snapshot, ftp: { current: 250, baseline: 230, delta: 20 } } }
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => briefData })
      .mockResolvedValueOnce({ ok: true, json: async () => updated })

    const { rerender } = render(<ProgressStats syncVersion={0} />)
    await screen.findByText('245W')
    rerender(<ProgressStats syncVersion={1} />)
    expect(await screen.findByText('250W')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
