import { render, fireEvent, screen } from '@testing-library/react'
import RideMapGraph from '@/components/ride/RideMapGraph'
import type { RideStreams } from '@/types'
import type { RideHighlight } from '@/lib/ride-highlights'

const streams: RideStreams = {
  time: [0, 60, 120], distance: [0, 2500, 5000], latlng: null,
  power: [100, 200, 150], hr: null, altitude: null, cadence: null, velocity: null,
}

const highlights: RideHighlight[] = [
  { kind: 'climb', start_km: 2.5, data: { start_km: 2.5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675, length_km: 3.2, path: null } },
]

const twoClimbs: RideHighlight[] = [
  { kind: 'climb', start_km: 0, data: { start_km: 0, duration_secs: 60, elev_gain_m: 40, avg_watts: 200, vam: 500, length_km: 1.1, path: null } },
  { kind: 'climb', start_km: 5, data: { start_km: 5, duration_secs: 60, elev_gain_m: 50, avg_watts: 220, vam: 550, length_km: 1.4, path: null } },
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

  it('always scrolls back to the top of the map section on a card click', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    ;(Element.prototype.scrollIntoView as jest.Mock).mockClear()
    fireEvent.click(screen.getByTestId('highlight-card'))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('clicking a card also activates the highlight: its card gets the ring and its chart marker gets the blue outline', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    const card = screen.getByTestId('highlight-card')
    fireEvent.click(card)
    expect(card).toHaveClass('ring-2')
    const activeCircle = document.querySelector('[data-testid="graph-marker"] circle[r="9"]')
    expect(activeCircle).toHaveAttribute('stroke', '#60a5fa')
  })
})

describe('RideMapGraph highlight selection toggle', () => {
  it('clicking the active card again deselects it: ring and dot outline clear, no extra scroll', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    const card = screen.getByTestId('highlight-card')
    fireEvent.click(card)
    expect(card).toHaveClass('ring-2')
    ;(Element.prototype.scrollIntoView as jest.Mock).mockClear()

    fireEvent.click(card)
    expect(card).not.toHaveClass('ring-2')
    const circle = document.querySelector('[data-testid="graph-marker"] circle[r="9"]')
    expect(circle).toHaveAttribute('stroke', '#fff')
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('tapping the active marker again deselects it: card ring clears, no extra scroll', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    const marker = document.querySelector('[data-testid="graph-marker"]')!
    fireEvent.click(marker)
    const card = screen.getByTestId('highlight-card')
    expect(card).toHaveClass('ring-2')
    ;(Element.prototype.scrollIntoView as jest.Mock).mockClear()

    fireEvent.click(marker)
    expect(card).not.toHaveClass('ring-2')
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('clicking a different card replaces the active selection instead of toggling it off', () => {
    render(<RideMapGraph streams={streams} highlights={twoClimbs} />)
    const cards = screen.getAllByTestId('highlight-card')
    fireEvent.click(cards[0])
    expect(cards[0]).toHaveClass('ring-2')

    fireEvent.click(cards[1])
    expect(cards[0]).not.toHaveClass('ring-2')
    expect(cards[1]).toHaveClass('ring-2')
  })

  it('selecting a card moves the cursor and scrolls, but re-clicking to deselect does not move it again', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    const card = screen.getByTestId('highlight-card')
    fireEvent.click(card)
    const distAfterSelect = screen.getByText(/km$/).textContent

    fireEvent.click(card)
    expect(screen.getByText(/km$/).textContent).toBe(distAfterSelect)
  })
})
