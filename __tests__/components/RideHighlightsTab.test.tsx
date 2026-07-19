import { render, screen } from '@testing-library/react'
import RideHighlightsTab from '@/components/RideHighlightsTab'
import type { RideHighlight } from '@/lib/ride-highlights'

const highlights: RideHighlight[] = [
  { kind: 'effort', start_km: 5, data: { start_km: 5, duration_secs: 300, avg_watts: 230, zone: 'z4' } },
  { kind: 'climb', start_km: 10, data: { start_km: 10, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 } },
  { kind: 'sprint', start_km: null, data: { duration_secs: 5, watts: 890 } },
  { kind: 'personal_best', start_km: null, data: { duration_secs: 300, watts: 312, window_days: 90 } },
]

describe('RideHighlightsTab', () => {
  it('renders one card per highlight in the given order', () => {
    render(<RideHighlightsTab highlights={highlights} />)
    expect(screen.getByText(/Effort/)).toBeInTheDocument()
    expect(screen.getByText(/km 5/)).toBeInTheDocument()
    expect(screen.getByText(/5min in Z4 Threshold/)).toBeInTheDocument()
    expect(screen.getByText(/230W avg/)).toBeInTheDocument()

    expect(screen.getByText(/Climb/)).toBeInTheDocument()
    expect(screen.getByText(/km 10/)).toBeInTheDocument()
    expect(screen.getByText(/8min · 90m gain · 268W avg · VAM 675/)).toBeInTheDocument()

    expect(screen.getByText(/Sprint/)).toBeInTheDocument()
    expect(screen.getByText(/5s · 890W/)).toBeInTheDocument()

    expect(screen.getByText(/Personal best/)).toBeInTheDocument()
    expect(screen.getByText(/5min power: 312W \(90-day best\)/)).toBeInTheDocument()
  })

  it('renders nothing when there are no highlights', () => {
    const { container } = render(<RideHighlightsTab highlights={[]} />)
    expect(container.querySelectorAll('[data-testid="highlight-card"]')).toHaveLength(0)
  })
})
