import { render, screen, fireEvent } from '@testing-library/react'
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

  it('applies a highlight style to the card at activeIndex and registers refs', () => {
    const registered: Array<[number, boolean]> = []
    const onRegisterRef = (index: number, el: HTMLDivElement | null) => registered.push([index, el !== null])
    render(<RideHighlightsTab highlights={highlights} activeIndex={1} onRegisterRef={onRegisterRef} />)
    const cards = screen.getAllByTestId('highlight-card')
    expect(cards[1]).toHaveClass('ring-2')
    expect(cards[0]).not.toHaveClass('ring-2')
    expect(registered.some(([index, mounted]) => index === 1 && mounted)).toBe(true)
  })

  it('calls onCardClick for climb/effort cards but not for sprint/personal_best cards', () => {
    const onCardClick = jest.fn()
    render(<RideHighlightsTab highlights={highlights} onCardClick={onCardClick} />)
    const cards = screen.getAllByTestId('highlight-card')

    fireEvent.click(cards[0]) // effort
    expect(onCardClick).toHaveBeenCalledWith(0)

    onCardClick.mockClear()
    fireEvent.click(cards[2]) // sprint — no handler attached
    expect(onCardClick).not.toHaveBeenCalled()
  })
})
