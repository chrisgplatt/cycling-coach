import { render, screen, fireEvent } from '@testing-library/react'
import WorkoutCard from '@/components/WorkoutCard'
import { makeWorkout } from '../support/factories'

const workout = makeWorkout({
  date: '2026-05-15',
  type: 'threshold',
  duration_minutes: 60,
  description: '2x20min at threshold',
  target_zones: 'Zone 4 (91-105% FTP)',
})

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

  it('shows planned → actual time for completed workout', () => {
    render(<WorkoutCard workout={{ ...workout, status: 'completed', icu_activity_id: 'act1', tss: 94, actual_duration_minutes: 65 }} />)
    expect(screen.getByText(/60 → 65 min/)).toBeInTheDocument()
  })

  it('shows only planned time when actual duration is not yet known', () => {
    render(<WorkoutCard workout={{ ...workout, status: 'completed', icu_activity_id: 'act1', tss: 94 }} />)
    expect(screen.getByText(/^60 min$/)).toBeInTheDocument()
  })

  it('shows an estimated TSS badge for a planned workout', () => {
    render(<WorkoutCard workout={workout} />)
    // threshold 60min: IF=0.85, est = round(60*60*0.85*0.85/36) = 72
    expect(screen.getByText(/~72 TSS/)).toBeInTheDocument()
  })

  it('does not show a TSS badge for a non-planned workout with no TSS', () => {
    render(<WorkoutCard workout={{ ...workout, status: 'skipped' }} />)
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

  it('falls back to the stored target_zones string when no ftp/steps are given', () => {
    render(<WorkoutCard workout={workout} />)
    expect(screen.getByText('Zone 4 (91-105% FTP)')).toBeInTheDocument()
  })

  it('renders live target zones from steps × current FTP, not the stored watt text', () => {
    const stepped = {
      ...workout,
      target_zones: 'Zone 4 (240-265W)', // stale watts baked at an old FTP
      steps: [
        { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 },
        { label: 'Effort', duration_minutes: 20, power_pct_ftp: 100 },
        { label: 'Cool Down', duration_minutes: 10, power_pct_ftp: 55 },
      ],
    }
    render(<WorkoutCard workout={stepped} ftp={300} />)
    // 100% of 300W = 300W, recomputed live — the stale 240-265W string is not shown
    expect(screen.getByText('Z4 Threshold · 300W')).toBeInTheDocument()
    expect(screen.queryByText(/240-265W/)).not.toBeInTheDocument()
  })
})
