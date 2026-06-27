/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import ActivityStatsPanel from '@/components/ActivityStatsPanel'
import type { ActivitySummary } from '@/types'

function act(date: string, type: string, distanceM: number | null = 40000, elevationM: number | null = 500, movingTimeSecs = 7200): ActivitySummary {
  return { date, type, distanceM, elevationM, movingTimeSecs }
}

const TODAY = '2026-06-24'  // Wednesday, week starts Jun 22

const activities: ActivitySummary[] = [
  act('2026-06-22', 'Ride', 41000, 786, 7440),
  act('2026-06-23', 'Run',  8000,  50,  2400),
  act('2026-06-22', 'WeightTraining', null, null, 3600),
]

describe('ActivityStatsPanel', () => {
  it('renders a panel for each active type', () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    expect(screen.getByText(/Rides/)).toBeInTheDocument()
    expect(screen.getByText(/Runs/)).toBeInTheDocument()
    expect(screen.getByText(/Other/)).toBeInTheDocument()
    // No Walk activity — Walk panel should not render
    expect(screen.queryByText(/Walks/)).not.toBeInTheDocument()
  })

  it('shows distance and elevation for the Ride panel', () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    expect(screen.getByText('41.0 km')).toBeInTheDocument()
    expect(screen.getByText('786 m')).toBeInTheDocument()
  })

  it('shows Sessions count in the Other panel and no Elevation label in it', () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    expect(screen.getByText('1 session')).toBeInTheDocument()
  })

  it('renders an SVG chart for each active type', () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    const charts = document.querySelectorAll('svg[data-testid="activity-chart"]')
    expect(charts.length).toBe(3) // Ride, Run, Other
  })

  it('renders without crash when activities is empty', () => {
    const { container } = render(<ActivityStatsPanel activities={[]} today={TODAY} />)
    expect(container.firstChild).not.toBeNull()
  })
})
