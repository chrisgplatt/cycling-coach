import { render, screen } from '@testing-library/react'
import { RideMedalIcons, RideMedalList } from '@/components/RideMedals'

describe('RideMedalIcons', () => {
  it('renders nothing when medals is null', () => {
    const { container } = render(<RideMedalIcons medals={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when medals is undefined', () => {
    const { container } = render(<RideMedalIcons medals={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when both lists are empty', () => {
    const { container } = render(<RideMedalIcons medals={{ allTime: [], year: [] }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders only the trophy when only allTime has entries', () => {
    render(<RideMedalIcons medals={{ allTime: [{ category: 'power', subKey: '300', rank: 1 }], year: [] }} />)
    expect(screen.getByTitle('All-time record')).toBeInTheDocument()
    expect(screen.queryByTitle('Year-best record')).not.toBeInTheDocument()
  })

  it('renders only the medal when only year has entries', () => {
    render(<RideMedalIcons medals={{ allTime: [], year: [{ category: 'max_speed', subKey: '', rank: 1 }] }} />)
    expect(screen.queryByTitle('All-time record')).not.toBeInTheDocument()
    expect(screen.getByTitle('Year-best record')).toBeInTheDocument()
  })

  it('renders both when both lists have entries', () => {
    render(<RideMedalIcons medals={{
      allTime: [{ category: 'biggest_climb', subKey: '', rank: 1 }],
      year: [{ category: 'power', subKey: '300', rank: 1 }],
    }} />)
    expect(screen.getByTitle('All-time record')).toBeInTheDocument()
    expect(screen.getByTitle('Year-best record')).toBeInTheDocument()
  })

  it('shows no rank suffix for a rank-1 entry', () => {
    render(<RideMedalIcons medals={{ allTime: [{ category: 'power', subKey: '300', rank: 1 }], year: [] }} />)
    expect(screen.getByTitle('All-time record')).toHaveTextContent('🏆')
    expect(screen.getByTitle('All-time record')).not.toHaveTextContent('🏆 1')
  })

  it('appends the rank number for a rank-2 or rank-3 entry', () => {
    render(<RideMedalIcons medals={{ allTime: [{ category: 'power', subKey: '300', rank: 3 }], year: [] }} />)
    expect(screen.getByTitle('All-time record')).toHaveTextContent('🏆 3')
  })

  it('picks the best (lowest) rank across multiple entries in the same tier', () => {
    render(<RideMedalIcons medals={{
      allTime: [
        { category: 'power', subKey: '300', rank: 3 },
        { category: 'biggest_climb', subKey: '', rank: 1 },
      ],
      year: [],
    }} />)
    expect(screen.getByTitle('All-time record')).toHaveTextContent('🏆')
    expect(screen.getByTitle('All-time record')).not.toHaveTextContent('🏆 3')
  })
})

describe('RideMedalList', () => {
  it('renders nothing when medals is null', () => {
    const { container } = render(<RideMedalList medals={null} year="2026" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when both lists are empty', () => {
    const { container } = render(<RideMedalList medals={{ allTime: [], year: [] }} year="2026" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('labels a rank-1 all-time entry with its category and no rank suffix', () => {
    render(<RideMedalList medals={{ allTime: [{ category: 'biggest_climb', subKey: '', rank: 1 }], year: [] }} year="2026" />)
    expect(screen.getByText('All-time · Biggest climb')).toBeInTheDocument()
  })

  it('appends the rank number for a rank-2 all-time entry', () => {
    render(<RideMedalList medals={{ allTime: [{ category: 'biggest_climb', subKey: '', rank: 2 }], year: [] }} year="2026" />)
    expect(screen.getByText('All-time #2 · Biggest climb')).toBeInTheDocument()
  })

  it('appends the rank number for a rank-3 year entry, alongside the year label', () => {
    render(<RideMedalList medals={{ allTime: [], year: [{ category: 'power', subKey: '300', rank: 3 }] }} year="2026" />)
    expect(screen.getByText('2026 best #3 · Power 5 min')).toBeInTheDocument()
  })

  it('labels a year entry with the given year, its category, and the duration for power', () => {
    render(<RideMedalList medals={{ allTime: [], year: [{ category: 'power', subKey: '300', rank: 1 }] }} year="2026" />)
    expect(screen.getByText('2026 best · Power 5 min')).toBeInTheDocument()
  })

  it('formats a sub-minute power duration in seconds', () => {
    render(<RideMedalList medals={{ allTime: [{ category: 'power', subKey: '15', rank: 1 }], year: [] }} year="2026" />)
    expect(screen.getByText('All-time · Power 15s')).toBeInTheDocument()
  })

  it('formats a speed entry with its distance in km', () => {
    render(<RideMedalList medals={{ allTime: [{ category: 'speed', subKey: '10', rank: 1 }], year: [] }} year="2026" />)
    expect(screen.getByText('All-time · Speed 10 km')).toBeInTheDocument()
  })

  it('renders one row per entry across both tiers', () => {
    render(<RideMedalList medals={{
      allTime: [{ category: 'biggest_climb', subKey: '', rank: 1 }],
      year: [{ category: 'power', subKey: '300', rank: 1 }, { category: 'max_speed', subKey: '', rank: 2 }],
    }} year="2025" />)
    expect(screen.getByText('All-time · Biggest climb')).toBeInTheDocument()
    expect(screen.getByText('2025 best · Power 5 min')).toBeInTheDocument()
    expect(screen.getByText('2025 best #2 · Max speed')).toBeInTheDocument()
  })
})
