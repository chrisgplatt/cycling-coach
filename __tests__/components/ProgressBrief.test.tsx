import { render, screen } from '@testing-library/react'
import ProgressBrief from '@/components/ProgressBrief'

const mockFetch = jest.fn()
global.fetch = mockFetch

const briefData = {
  content: 'Your CTL has grown 15 points since starting this plan.',
  metrics_snapshot: {
    ftp: { current: 245, baseline: 230, delta: 15 },
    ctl: { current: 70, baseline: 55, delta: 15 },
    wkg: null,
    weight: { current: 73.5, baseline: 75.0, delta: -1.5 },
    adherence: { completed: 14, total: 16 },
    planPhase: 'build',
    targetEvent: 'Dragon Ride',
    targetDate: '2026-09-01',
    planStartDate: '2026-04-01',
  },
  generated_at: new Date(Date.now() - 600000).toISOString(),
}

beforeEach(() => mockFetch.mockReset())

describe('ProgressBrief', () => {
  it('renders the coach brief text', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressBrief syncVersion={0} />)
    expect(await screen.findByText(/CTL has grown 15 points/)).toBeInTheDocument()
  })

  it('renders FTP metric tile with delta', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressBrief syncVersion={0} />)
    expect(await screen.findByText('245W')).toBeInTheDocument()
    expect(await screen.findByText('+15')).toBeInTheDocument()
  })

  it('renders weight tile with negative delta', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressBrief syncVersion={0} />)
    expect(await screen.findByText('73.5kg')).toBeInTheDocument()
    expect(await screen.findByText('-1.5')).toBeInTheDocument()
  })

  it('renders adherence tile', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressBrief syncVersion={0} />)
    expect(await screen.findByText('14/16')).toBeInTheDocument()
  })

  it('renders nothing when API returns null', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => null })
    const { container } = render(<ProgressBrief syncVersion={0} />)
    // Wait for fetch to complete
    await screen.findByRole?.('region').catch(() => {})
    await new Promise(r => setTimeout(r, 0))
    expect(container.firstChild).toBeNull()
  })

  it('re-fetches when syncVersion changes', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => briefData })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...briefData, content: 'Updated brief.' }) })

    const { rerender } = render(<ProgressBrief syncVersion={0} />)
    await screen.findByText(/CTL has grown/)
    rerender(<ProgressBrief syncVersion={1} />)
    expect(await screen.findByText('Updated brief.')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
