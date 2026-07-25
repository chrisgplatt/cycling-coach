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
    render(<RideMedalIcons medals={{ allTime: [{ category: 'power', subKey: '300' }], year: [] }} />)
    expect(screen.getByTitle('All-time record')).toBeInTheDocument()
    expect(screen.queryByTitle('Year-best record')).not.toBeInTheDocument()
  })

  it('renders only the medal when only year has entries', () => {
    render(<RideMedalIcons medals={{ allTime: [], year: [{ category: 'max_speed', subKey: '' }] }} />)
    expect(screen.queryByTitle('All-time record')).not.toBeInTheDocument()
    expect(screen.getByTitle('Year-best record')).toBeInTheDocument()
  })

  it('renders both when both lists have entries', () => {
    render(<RideMedalIcons medals={{
      allTime: [{ category: 'biggest_climb', subKey: '' }],
      year: [{ category: 'power', subKey: '300' }],
    }} />)
    expect(screen.getByTitle('All-time record')).toBeInTheDocument()
    expect(screen.getByTitle('Year-best record')).toBeInTheDocument()
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

  it('labels an all-time entry with its category', () => {
    render(<RideMedalList medals={{ allTime: [{ category: 'biggest_climb', subKey: '' }], year: [] }} year="2026" />)
    expect(screen.getByText('All-time · Biggest climb')).toBeInTheDocument()
  })

  it('labels a year entry with the given year and its category', () => {
    render(<RideMedalList medals={{ allTime: [], year: [{ category: 'power', subKey: '300' }] }} year="2026" />)
    expect(screen.getByText('2026 best · Power')).toBeInTheDocument()
  })

  it('renders one row per entry across both tiers', () => {
    render(<RideMedalList medals={{
      allTime: [{ category: 'biggest_climb', subKey: '' }],
      year: [{ category: 'power', subKey: '300' }, { category: 'max_speed', subKey: '' }],
    }} year="2025" />)
    expect(screen.getByText('All-time · Biggest climb')).toBeInTheDocument()
    expect(screen.getByText('2025 best · Power')).toBeInTheDocument()
    expect(screen.getByText('2025 best · Max speed')).toBeInTheDocument()
  })
})
