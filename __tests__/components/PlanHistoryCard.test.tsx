import { render, screen, fireEvent } from '@testing-library/react'
import PlanHistoryCard from '@/components/plan/PlanHistoryCard'
import { makeArchiveSummary } from '../support/factories'

const basePlan = {
  id: 'p1',
  name: 'Spring Build',
  target_event_name: 'Sportive',
  target_event_date: '2026-06-26',
  closed_at: '2026-06-26',
  archive_summary: makeArchiveSummary({
    weeks: [
      { weekIndex: 0, weekStart: '2026-05-01', plannedSessions: 4, completedSessions: 3, plannedTss: 300, actualTss: 250, hours: 5.5 },
    ],
  }),
}

describe('PlanHistoryCard', () => {
  it('renders name, sessions, hours, TSS, and fitness change', () => {
    render(<PlanHistoryCard plan={basePlan} />)
    expect(screen.getByText('Spring Build')).toBeInTheDocument()
    expect(screen.getByText('20/24')).toBeInTheDocument()
    expect(screen.getByText('30.0')).toBeInTheDocument()
    expect(screen.getByText('1800')).toBeInTheDocument()
    expect(screen.getByText('CTL +8')).toBeInTheDocument()
  })

  it('shows a "Closed early" badge when the plan was closed before its planned end', () => {
    const plan = { ...basePlan, archive_summary: makeArchiveSummary({ closedEarly: true }) }
    render(<PlanHistoryCard plan={plan} />)
    expect(screen.getByText('Closed early')).toBeInTheDocument()
  })

  it('does not show the badge for a plan that ran its full course', () => {
    render(<PlanHistoryCard plan={basePlan} />)
    expect(screen.queryByText('Closed early')).not.toBeInTheDocument()
  })

  it('shows "Fitness data unavailable" instead of a CTL figure when fitnessChange is null', () => {
    const plan = { ...basePlan, archive_summary: makeArchiveSummary({ fitnessChange: null }) }
    render(<PlanHistoryCard plan={plan} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('expands to show the per-week table on tap', () => {
    render(<PlanHistoryCard plan={basePlan} />)
    expect(screen.queryByText(/Wk 1/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Spring Build'))
    expect(screen.getByText(/Wk 1/)).toBeInTheDocument()
  })
})
