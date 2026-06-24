/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import StreakCalendar from '@/components/StreakCalendar'
import type { ActivitySummary } from '@/types'

function act(date: string, type = 'Ride'): ActivitySummary {
  return { date, type, distanceM: 40000, elevationM: 500, movingTimeSecs: 3600 }
}

const TODAY = '2026-06-24'

const activities = [
  act('2026-06-22'), act('2026-06-23'), // current week (Mon, Tue)
  act('2026-06-15'), act('2026-06-17'), // week of Jun 15
  act('2026-06-08'),                     // week of Jun 8
]

describe('StreakCalendar', () => {
  it('renders 7 day-of-week column headers', () => {
    render(<StreakCalendar activities={activities} today={TODAY} />)
    expect(screen.getByText('M')).toBeInTheDocument()
    expect(screen.getAllByText('T')[0]).toBeInTheDocument()  // Tue (and Thu)
    expect(screen.getAllByText('S')[0]).toBeInTheDocument()  // Sat or Sun
  })

  it('renders activity days with filled-circle class', () => {
    render(<StreakCalendar activities={activities} today={TODAY} />)
    // Activity on Jun 22 — the circle has a specific class
    const circles = document.querySelectorAll('[data-testid="activity-circle"]')
    expect(circles.length).toBeGreaterThan(0)
  })

  it('renders streak and activity count in header', () => {
    render(<StreakCalendar activities={activities} today={TODAY} />)
    // Streak = 3 weeks (Jun 8, 15, 22)
    expect(screen.getByText(/3 Weeks/)).toBeInTheDocument()
    expect(screen.getByText(/5 Activities/)).toBeInTheDocument()
  })

  it('shows flame icon in current week right column when streak > 0', () => {
    render(<StreakCalendar activities={activities} today={TODAY} />)
    expect(screen.getByTestId('week-flame')).toBeInTheDocument()
  })

  it('shows checkmark in past complete weeks with activity', () => {
    render(<StreakCalendar activities={activities} today={TODAY} />)
    const checks = screen.getAllByTestId('week-check')
    expect(checks.length).toBeGreaterThan(0)
  })

  it('navigates to previous month on left arrow click', () => {
    render(<StreakCalendar activities={activities} today={TODAY} />)
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Previous month'))
    expect(screen.getByText('May 2026')).toBeInTheDocument()
  })

  it('renders without crash when activities is empty', () => {
    const { container } = render(<StreakCalendar activities={[]} today={TODAY} />)
    expect(container.firstChild).not.toBeNull()
  })
})
