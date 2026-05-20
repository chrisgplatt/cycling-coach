import { render, screen, fireEvent } from '@testing-library/react'
import WorkoutCard from '@/components/WorkoutCard'
import type { Workout } from '@/types'

const workout: Workout = {
  id: 'w1', plan_id: 'p1', date: '2026-05-15',
  type: 'threshold', duration_minutes: 60,
  description: '2x20min at threshold', target_zones: 'Zone 4 (91-105% FTP)',
  intervals_icu_event_id: null, status: 'planned',
  icu_activity_id: null, tss: null, missed_reason: null, steps: null,
  created_at: '',
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

  it('shows needs review badge for needs_review workout', () => {
    render(<WorkoutCard workout={{ ...workout, status: 'needs_review', icu_activity_id: 'act1', tss: 85 }} />)
    expect(screen.getByText(/needs review/i)).toBeInTheDocument()
  })

  it('shows planned → actual TSS for completed workout', () => {
    render(<WorkoutCard workout={{ ...workout, status: 'completed', icu_activity_id: 'act1', tss: 94 }} />)
    // threshold 60min: IF=0.85, planned = round(60*60*0.85*0.85/36) = 72
    expect(screen.getByText(/~72 → 94 TSS/)).toBeInTheDocument()
  })

  it('does not show TSS badge when tss is null', () => {
    render(<WorkoutCard workout={workout} />)
    expect(screen.queryByText(/TSS/)).not.toBeInTheDocument()
  })

  it('calls onClick when card is clicked', () => {
    const onClick = jest.fn()
    const { container } = render(<WorkoutCard workout={workout} onClick={onClick} />)
    fireEvent.click(container.firstChild as HTMLElement)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('applies cursor-pointer class when onClick is provided', () => {
    const { container } = render(<WorkoutCard workout={workout} onClick={jest.fn()} />)
    expect(container.firstChild).toHaveClass('cursor-pointer')
  })

  it('does not apply cursor-pointer when no onClick', () => {
    const { container } = render(<WorkoutCard workout={workout} />)
    expect(container.firstChild).not.toHaveClass('cursor-pointer')
  })
})
