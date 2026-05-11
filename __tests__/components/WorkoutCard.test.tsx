import { render, screen } from '@testing-library/react'
import WorkoutCard from '@/components/WorkoutCard'
import type { Workout } from '@/types'

const workout: Workout = {
  id: 'w1', plan_id: 'p1', date: '2026-05-15',
  type: 'threshold', duration_minutes: 60,
  description: '2x20min at threshold', target_zones: 'Zone 4 (91-105% FTP)',
  intervals_icu_event_id: null, status: 'planned', created_at: '',
}

describe('WorkoutCard', () => {
  it('renders workout type and duration', () => {
    render(<WorkoutCard workout={workout} />)
    expect(screen.getAllByText(/threshold/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/60/)).toBeInTheDocument()
  })

  it('shows a planned status badge', () => {
    render(<WorkoutCard workout={workout} />)
    expect(screen.getByText(/planned/i)).toBeInTheDocument()
  })

  it('shows completed badge for completed workout', () => {
    render(<WorkoutCard workout={{ ...workout, status: 'completed' }} />)
    expect(screen.getByText(/completed/i)).toBeInTheDocument()
  })
})
