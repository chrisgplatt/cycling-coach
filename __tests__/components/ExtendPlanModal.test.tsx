import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import ExtendPlanModal from '@/components/ExtendPlanModal'
import type { GeneratedPlan, TrainingEvent, TrainingPhilosophy } from '@/types'

const philosophy: TrainingPhilosophy = {
  name: 'friel-polarised-base',
  label: 'Friel periodization · polarised base',
  phase_weeks: { base: 4, build: 5, peak: 1, taper: 2 },
  intensity_profile: 'polarised-base',
  weekly_hours_at_creation: 9,
  rationale: 'Based on your 9.0h/week schedule.',
}

function daysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

const eventA: TrainingEvent = {
  name: 'Dragon Ride',
  date: daysFromNow(30),
  type: 'sportive',
  priority: 'A',
}

const eventC: TrainingEvent = {
  name: 'Club Ride',
  date: daysFromNow(30),
  type: 'sportive',
  priority: 'C',
}

const baseProps = {
  planEndDate: '2026-08-22',
  planCreatedAt: '2026-06-01T00:00:00Z',
  planWeeks: 12,
  currentPhilosophy: philosophy,
  weeklyHours: 9,
  events: [],
  currentCTL: 55,
  onSuccess: jest.fn(),
  onClose: jest.fn(),
}

beforeEach(() => {
  baseProps.onSuccess.mockReset()
  baseProps.onClose.mockReset()
})

describe('ExtendPlanModal — no events', () => {
  it('renders header and week chips', () => {
    render(<ExtendPlanModal {...baseProps} />)
    expect(screen.getByText('Extend plan')).toBeInTheDocument()
    expect(screen.getByText('When do you want to extend to?')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByText('+4')).toBeInTheDocument()
    expect(screen.getByText('+6')).toBeInTheDocument()
    expect(screen.getByText('+8')).toBeInTheDocument()
  })

  it('CTA button defaults to +2 weeks label', () => {
    render(<ExtendPlanModal {...baseProps} />)
    expect(screen.getByRole('button', { name: /extend plan by 2/i })).toBeInTheDocument()
  })

  it('CTA label updates when +4 chip is selected', () => {
    render(<ExtendPlanModal {...baseProps} />)
    fireEvent.click(screen.getByText('+4'))
    expect(screen.getByRole('button', { name: /extend plan by 4/i })).toBeInTheDocument()
  })

  it('calls onClose when cancel is clicked', () => {
    render(<ExtendPlanModal {...baseProps} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(baseProps.onClose).toHaveBeenCalled()
  })
})

describe('ExtendPlanModal — with C-priority events', () => {
  it('renders event rows alongside week chips', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventC]} />)
    expect(screen.getByText('Club Ride')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('selecting an event row updates the CTA label', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventC]} />)
    fireEvent.click(screen.getByText('Club Ride'))
    expect(screen.getByRole('button', { name: /extend to Club Ride/i })).toBeInTheDocument()
  })
})

describe('ExtendPlanModal — with A-priority event (pre-selected)', () => {
  it('pre-selects the A/B event and shows event CTA', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventA]} />)
    expect(screen.getByText('Dragon Ride')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /extend to Dragon Ride/i })).toBeInTheDocument()
  })
})

function generatedPlan(): GeneratedPlan {
  return {
    rationale: 'r',
    target_event_name: 'E',
    target_event_date: '2026-09-01',
    phase: 'build',
    week_phases: ['build', 'build'],
    workouts: [
      { date: '2026-08-23', type: 'endurance', duration_minutes: 60, description: 'd', target_zones: 'Z2', steps: [] },
      { date: '2026-08-30', type: 'endurance', duration_minutes: 60, description: 'd', target_zones: 'Z2', steps: [] },
    ],
  }
}

describe('ExtendPlanModal — job submission and polling', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('submits a job, polls until done, and shows the review phase', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ job_id: 'job1', extra_weeks: 2, new_total_weeks: 14 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'running', progress: { total: 2, completed: 1 }, result: null, error: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'done', progress: { total: 2, completed: 2 }, result: generatedPlan(), error: null }) })

    render(<ExtendPlanModal {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /extend plan by 2/i }))

    expect(screen.getByText('Generating extension…')).toBeInTheDocument()

    await act(async () => { await jest.advanceTimersByTimeAsync(3000) })
    await act(async () => { await jest.advanceTimersByTimeAsync(3000) })

    await waitFor(() => {
      expect(screen.getByText('Your extended plan is ready')).toBeInTheDocument()
    })
    expect(screen.getByText('2 sessions generated')).toBeInTheDocument()
    expect(screen.getByText('Plan extended to 14 weeks total')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/plan/extend', expect.objectContaining({ method: 'POST' }))
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/plan/jobs/job1')
    expect(global.fetch).toHaveBeenNthCalledWith(3, '/api/plan/jobs/job1')
  })

  it('shows an error and returns to select phase when the job errors', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ job_id: 'job1', extra_weeks: 2, new_total_weeks: 14 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'error', progress: { total: 0, completed: 0 }, result: null, error: 'Claude API error' }) })

    render(<ExtendPlanModal {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /extend plan by 2/i }))

    await act(async () => { await jest.advanceTimersByTimeAsync(3000) })

    await waitFor(() => {
      expect(screen.getByText('Claude API error')).toBeInTheDocument()
    })
  })

  it('shows an error when job submission fails', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Bad request' }),
    })

    render(<ExtendPlanModal {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /extend plan by 2/i }))

    await waitFor(() => {
      expect(screen.getByText('Bad request')).toBeInTheDocument()
    })
  })
})
