import { render, screen, waitFor } from '@testing-library/react'
import RpeTrendStrip from '@/components/RpeTrendStrip'

function mockEntries(entries: Array<{ created_at: string; rpe: number | null; feel: number | null }>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, json: async () => ({ entries }),
  }) as unknown as typeof fetch
}

describe('RpeTrendStrip', () => {
  it('renders the strip when at least two RPE points exist', async () => {
    mockEntries([
      { created_at: '2026-06-03T18:00:00Z', rpe: 6, feel: 2 },
      { created_at: '2026-06-01T18:00:00Z', rpe: 8, feel: 3 },
    ])
    render(<RpeTrendStrip />)
    await waitFor(() => expect(screen.getByTestId('rpe-trend-strip')).toBeInTheDocument())
  })

  it('renders nothing when fewer than two RPE points exist', async () => {
    mockEntries([
      { created_at: '2026-06-03T18:00:00Z', rpe: 6, feel: 2 },
      { created_at: '2026-06-01T18:00:00Z', rpe: null, feel: null },
    ])
    const { container } = render(<RpeTrendStrip />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('rpe-trend-strip')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })
})
