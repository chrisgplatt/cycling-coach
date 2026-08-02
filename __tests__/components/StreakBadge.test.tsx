/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import StreakBadge from '@/components/StreakBadge'
import type { ActivitySummary } from '@/types'

function act(date: string, type = 'Ride'): ActivitySummary {
  return { date, type, distanceM: 20000, elevationM: 200, movingTimeSecs: 3600 }
}

const TODAY = '2026-06-24' // Wednesday, week starts Jun 22

describe('StreakBadge', () => {
  it('renders the streak count when there is an active streak', () => {
    const activities: ActivitySummary[] = [
      act('2026-06-22'),        // this week
      act('2026-06-15'),        // last week
      act('2026-06-08'),        // week before
    ]
    render(<StreakBadge activities={activities} today={TODAY} />)
    expect(screen.getByTestId('streak-badge')).toHaveTextContent('3-week streak')
  })

  it('renders nothing when there is no active streak', () => {
    const { container } = render(<StreakBadge activities={[]} today={TODAY} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when activities is undefined', () => {
    const { container } = render(<StreakBadge activities={undefined} today={TODAY} />)
    expect(container.firstChild).toBeNull()
  })
})
