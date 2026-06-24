/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import ActivityStatsPanel from '@/components/ActivityStatsPanel'
import type { ActivitySummary } from '@/types'

function act(date: string, type: string, distanceM = 40000, elevationM = 500, movingTimeSecs = 7200): ActivitySummary {
  return { date, type, distanceM, elevationM, movingTimeSecs }
}

const TODAY = '2026-06-24'  // Wednesday, week starts Jun 22

// This week (Jun 22–24)
const activities: ActivitySummary[] = [
  act('2026-06-22', 'Ride', 41000, 786, 7440),  // 41 km, 786m, 2h 4m
  act('2026-06-23', 'Run',  8000,  50,  2400),
  act('2026-06-22', 'WeightTraining', null, null, 3600),
]

describe('ActivityStatsPanel', () => {
  it('renders four activity tabs', () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    expect(screen.getByRole('button', { name: /Ride/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Walk/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Other/i })).toBeInTheDocument()
  })

  it('shows distance, time, elevation for Ride tab', async () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    fireEvent.click(screen.getByRole('button', { name: /Ride/i }))
    expect(screen.getByText('41.0 km')).toBeInTheDocument()
    expect(screen.getByText('786 m')).toBeInTheDocument()
  })

  it('shows Sessions count and no elevation for Other tab', () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    fireEvent.click(screen.getByRole('button', { name: /Other/i }))
    expect(screen.getByText('1 session')).toBeInTheDocument()
    expect(screen.queryByText(/elevation/i)).not.toBeInTheDocument()
  })

  it('renders an SVG chart', () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    expect(document.querySelector('svg[data-testid="activity-chart"]')).toBeInTheDocument()
  })

  it('renders without crash when activities is empty', () => {
    const { container } = render(<ActivityStatsPanel activities={[]} today={TODAY} />)
    expect(container.firstChild).not.toBeNull()
  })
})
