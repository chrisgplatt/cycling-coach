import { render, fireEvent, screen } from '@testing-library/react'
import RideMapGraph from '@/components/ride/RideMapGraph'
import type { RideStreams } from '@/types'
import type { RideHighlight } from '@/lib/ride-highlights'

const streams: RideStreams = {
  time: [0, 60, 120], distance: [0, 2500, 5000], latlng: null,
  power: [100, 200, 150], hr: null, altitude: null, cadence: null, velocity: null,
}

const highlights: RideHighlight[] = [
  { kind: 'climb', start_km: 2.5, data: { start_km: 2.5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 } },
]

beforeAll(() => {
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = jest.fn()
})

describe('RideMapGraph highlight wiring', () => {
  it('tapping a graph marker scrolls to and highlights the matching card', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    const marker = document.querySelector('[data-testid="graph-marker"]')
    expect(marker).toBeTruthy()
    fireEvent.click(marker!)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    const card = screen.getByTestId('highlight-card')
    expect(card).toHaveClass('ring-2')
  })

  it('renders no markers and no card list when there are no highlights', () => {
    render(<RideMapGraph streams={streams} highlights={[]} />)
    expect(document.querySelector('[data-testid="graph-marker"]')).toBeNull()
    expect(screen.queryByTestId('highlight-card')).toBeNull()
  })

  it('renders no markers when highlights is omitted entirely', () => {
    render(<RideMapGraph streams={streams} />)
    expect(document.querySelector('[data-testid="graph-marker"]')).toBeNull()
  })
})

describe('RideMapGraph controls', () => {
  it('does not render an X-axis toggle', () => {
    render(<RideMapGraph streams={streams} />)
    expect(screen.queryByRole('button', { name: 'Distance' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Time' })).toBeNull()
  })
})

describe('RideMapGraph card-click focus', () => {
  it('clicking a climb/effort card moves the chart cursor to that point', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    const card = screen.getByTestId('highlight-card')
    fireEvent.click(card)
    expect(screen.getByText('2.5km')).toBeInTheDocument()
  })

  it('does not move the cursor when a non-located highlight card is clicked', () => {
    const sprintOnly: RideHighlight[] = [{ kind: 'sprint', start_km: null, data: { duration_secs: 5, watts: 890 } }]
    render(<RideMapGraph streams={streams} highlights={sprintOnly} />)
    const card = screen.getByTestId('highlight-card')
    fireEvent.click(card)
    expect(screen.getByText('0.0km')).toBeInTheDocument()
  })
})
