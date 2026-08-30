import { render, screen, fireEvent } from '@testing-library/react'
import PlanPage from '@/app/plan/page'
import { generatePlanInBatches } from '@/lib/plan/generate-batches'
import { makeTrainingSummary } from '../../support/factories'

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({}),
})

jest.mock('@/lib/plan/generate-batches', () => ({ generatePlanInBatches: jest.fn() }))

describe('PlanPage tabs', () => {
  it('renders all three tab buttons', () => {
    render(<PlanPage />)
    expect(screen.getByRole('button', { name: /my plan/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /profile/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /events/i })).toBeInTheDocument()
  })

  it('shows My Plan panel by default and hides others', () => {
    render(<PlanPage />)
    expect(screen.getByTestId('tab-plan')).toBeVisible()
    expect(screen.getByTestId('tab-profile')).not.toBeVisible()
    expect(screen.getByTestId('tab-events')).not.toBeVisible()
  })

  it('switches to Profile panel on tab click', () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(screen.getByTestId('tab-profile')).toBeVisible()
    expect(screen.getByTestId('tab-plan')).not.toBeVisible()
  })

  it('switches to Events panel on tab click', () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /events/i }))
    expect(screen.getByTestId('tab-events')).toBeVisible()
    expect(screen.getByTestId('tab-plan')).not.toBeVisible()
  })
})

describe('Profile & Schedule tab', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (url.includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => makeTrainingSummary() })
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'p1',
          current_ftp: 265,
          weight_kg: 78.5,
          goals: 'Complete Dragon Ride',
          weekly_availability: [
            { day: 'monday', duration_minutes: 90 },
            { day: 'saturday', duration_minutes: 180 },
          ],
          events: [],
        }),
      })
    })
  })

  it('shows goals textarea when Goals Edit is clicked', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    fireEvent.click(await screen.findByRole('button', { name: /edit goals/i }))
    expect(screen.getByPlaceholderText(/your goals/i)).toBeInTheDocument()
  })

  it('shows FTP input when Stats Edit is clicked', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    fireEvent.click(await screen.findByRole('button', { name: /edit stats/i }))
    expect(screen.getByLabelText(/ftp/i)).toBeInTheDocument()
  })

  it('shows save and cancel buttons when a section is being edited', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    fireEvent.click(await screen.findByRole('button', { name: /edit goals/i }))
    expect(screen.getByRole('button', { name: /save goals/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('shows the calculated Max HR when a date of birth is on file', async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (url.includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => makeTrainingSummary() })
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'p1', current_ftp: 265, weight_kg: 78.5, goals: '',
          weekly_availability: [], events: [],
          date_of_birth: '1990-01-01', max_hr_manual: null, observed_max_hr: null,
        }),
      })
    })
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(await screen.findByText(/bpm/)).toBeInTheDocument()
    expect(screen.getByText(/estimated from age/)).toBeInTheDocument()
  })

  it('shows a "not set" message when no date of birth or Max HR source is available', async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (url.includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => makeTrainingSummary() })
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'p1', current_ftp: 265, weight_kg: 78.5, goals: '',
          weekly_availability: [], events: [],
          date_of_birth: null, max_hr_manual: null, observed_max_hr: null,
        }),
      })
    })
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(await screen.findByText(/not set/i)).toBeInTheDocument()
  })

  it('shows only the latest weight (no log form) when not editing stats', async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/weight-log') {
        return Promise.resolve({ ok: true, json: async () => ({ entries: [{ id: 'w1', date: '2026-07-10', weight_kg: 76.2 }] }) })
      }
      if (url.includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (url.includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => makeTrainingSummary() })
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: 'p1', current_ftp: 265, weight_kg: 76.2, goals: '', weekly_availability: [], events: [] }),
      })
    })
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(await screen.findByText('76.2 kg')).toBeInTheDocument()
    expect(screen.queryByLabelText(/weight \(kg\)/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /log weight/i })).not.toBeInTheDocument()
  })

  it('shows an editable Max HR input with an auto-calculate hint when Stats Edit is clicked', async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (url.includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => makeTrainingSummary() })
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'p1', current_ftp: 265, weight_kg: 78.5, goals: '',
          weekly_availability: [], events: [],
          date_of_birth: '1990-01-01', max_hr_manual: null, observed_max_hr: null,
        }),
      })
    })
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    fireEvent.click(await screen.findByRole('button', { name: /edit stats/i }))
    expect(screen.getByLabelText(/max heart rate/i)).toBeInTheDocument()
    expect(screen.getByText(/leave blank to auto-calculate — currently \d+ bpm \(estimated from age\)/i)).toBeInTheDocument()
  })

  it('saves an entered Max HR value and shows it as manual after saving', async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
      }
      if (url.includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (url.includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => makeTrainingSummary() })
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'p1', current_ftp: 265, weight_kg: 78.5, goals: '',
          weekly_availability: [], events: [],
          date_of_birth: '1990-01-01', max_hr_manual: null, observed_max_hr: null,
        }),
      })
    })
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    fireEvent.click(await screen.findByRole('button', { name: /edit stats/i }))
    const maxHrInput = screen.getByLabelText(/max heart rate/i)
    fireEvent.change(maxHrInput, { target: { value: '188' } })
    fireEvent.click(screen.getByRole('button', { name: /save stats/i }))
    expect(await screen.findByText(/188 bpm/)).toBeInTheDocument()
    expect(screen.getByText(/\(manual\)/)).toBeInTheDocument()
  })

  it('shows the weight log form when Stats Edit is clicked', async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/weight-log') {
        return Promise.resolve({ ok: true, json: async () => ({ entries: [{ id: 'w1', date: '2026-07-10', weight_kg: 76.2 }] }) })
      }
      if (url.includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (url.includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => makeTrainingSummary() })
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: 'p1', current_ftp: 265, weight_kg: 76.2, goals: '', weekly_availability: [], events: [] }),
      })
    })
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    await screen.findByText('76.2 kg')
    fireEvent.click(screen.getByRole('button', { name: /edit stats/i }))
    expect(await screen.findByLabelText(/weight \(kg\)/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log weight/i })).toBeInTheDocument()
  })
})

describe('Events tab', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (url.includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => makeTrainingSummary() })
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'p1',
          goals: '',
          current_ftp: 200,
          weight_kg: 70,
          weekly_availability: [],
          events: [
            { name: 'Dragon Ride', date: '2026-06-25', type: 'sportive', priority: 'A', icu_event_id: 'evt1' },
          ],
        }),
      })
    })
  })

  it('lists events on Events tab', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /events/i }))
    expect(await screen.findByText('Dragon Ride')).toBeInTheDocument()
  })

  it('shows Add event button', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /events/i }))
    expect(await screen.findByRole('button', { name: /add event/i })).toBeInTheDocument()
  })

  it('shows Sync from intervals.icu button', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /events/i }))
    expect(await screen.findByRole('button', { name: /sync from intervals/i })).toBeInTheDocument()
  })
})

describe('My Plan tab', () => {
  it('shows plan name in hero card when plan exists', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/plan') return Promise.resolve({
        ok: true,
        json: async () => ({
          name: 'Dragon Ride Build',
          workouts: [
            { id: 'w1', date: '2026-05-12', type: 'endurance', duration_minutes: 90, status: 'planned', tss: null, icu_activity_id: null, missed_reason: null, steps: null, description: '', target_zones: '', intervals_icu_event_id: null, plan_id: 'p1', created_at: '' },
            { id: 'w2', date: '2026-06-15', type: 'threshold', duration_minutes: 60, status: 'planned', tss: null, icu_activity_id: null, missed_reason: null, steps: null, description: '', target_zones: '', intervals_icu_event_id: null, plan_id: 'p1', created_at: '' },
          ],
        }),
      })
      if (String(url).includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (String(url).includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => ({
        windowMonths: 12, windowStart: '2025-09-04',
        ridesCompleted: 0, hoursTrained: 0, weeksWithPlan: 0, weeksInWindow: 52,
        ctlStart: null, ctlEnd: null, fitnessChange: null,
        ftpStart: null, ftpEnd: null, ftpChange: null, ftpStartIsPartial: false,
      }) })
      return Promise.resolve({ ok: true, json: async () => ({ id: 'p1', goals: '', current_ftp: 200, weight_kg: 70, weekly_availability: [], events: [] }) })
    })
    render(<PlanPage />)
    expect(await screen.findByText('Dragon Ride Build')).toBeInTheDocument()
  })

  it('shows Build New Plan button when plan exists', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/plan') return Promise.resolve({
        ok: true,
        json: async () => ({ name: 'Dragon Ride Build', workouts: [] }),
      })
      if (String(url).includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (String(url).includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => ({
        windowMonths: 12, windowStart: '2025-09-04',
        ridesCompleted: 0, hoursTrained: 0, weeksWithPlan: 0, weeksInWindow: 52,
        ctlStart: null, ctlEnd: null, fitnessChange: null,
        ftpStart: null, ftpEnd: null, ftpChange: null, ftpStartIsPartial: false,
      }) })
      return Promise.resolve({ ok: true, json: async () => ({ id: 'p1', goals: '', current_ftp: 200, weight_kg: 70, weekly_availability: [], events: [{ name: 'Dragon Ride', date: '2026-06-25', type: 'sportive', priority: 'A' }] }) })
    })
    render(<PlanPage />)
    expect(await screen.findByRole('button', { name: /build new plan/i })).toBeInTheDocument()
  })

  it('shows empty state when no plan', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/plan') return Promise.resolve({ ok: true, json: async () => null })
      if (String(url).includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (String(url).includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => ({
        windowMonths: 12, windowStart: '2025-09-04',
        ridesCompleted: 0, hoursTrained: 0, weeksWithPlan: 0, weeksInWindow: 52,
        ctlStart: null, ctlEnd: null, fitnessChange: null,
        ftpStart: null, ftpEnd: null, ftpChange: null, ftpStartIsPartial: false,
      }) })
      return Promise.resolve({ ok: true, json: async () => ({ id: 'p1', goals: '', current_ftp: 200, weight_kg: 70, weekly_availability: [], events: [] }) })
    })
    render(<PlanPage />)
    expect(await screen.findByText(/no active plan/i)).toBeInTheDocument()
  })

  it('does not mistake unlinked completed rides for an active plan when confirming methodology', async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/plan') {
        // GET /api/plan's synthetic "no active plan" shell — carries unlinked
        // completed rides so the dashboard can still render them, but must not
        // be mistaken for an active plan.
        return Promise.resolve({
          ok: true,
          json: async () => ({
            workouts: [
              { id: 'w1', date: '2026-05-01', type: 'endurance', duration_minutes: 60, status: 'completed', tss: null, icu_activity_id: 'a1', missed_reason: null, steps: null, description: '', target_zones: '', intervals_icu_event_id: null, plan_id: null, created_at: '' },
            ],
          }),
        })
      }
      if (url.includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (url.includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => makeTrainingSummary() })
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'p1', goals: 'Complete a gran fondo', current_ftp: 200, weight_kg: 70,
          weekly_availability: [{ day: 'monday', duration_minutes: 60 }],
          events: [{ name: 'Dragon Ride', date: '2026-09-01', type: 'sportive', priority: 'A' }],
        }),
      })
    })

    render(<PlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: /build new plan/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^skip$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /use this approach/i }))

    expect(await screen.findByText(/build a new plan/i)).toBeInTheDocument()
    expect(screen.getAllByText(/no active plan/i)).toHaveLength(1)

    const planPatchCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url, init]) => String(url) === '/api/plan' && init?.method === 'PATCH'
    )
    expect(planPatchCalls).toHaveLength(0)
  })
})

describe('My Plan tab — batched plan generation wiring', () => {
  function mockProfileAndPlanFetch() {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/plan') return Promise.resolve({ ok: true, json: async () => ({ workouts: [] }) })
      if (url.includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      if (url.includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => makeTrainingSummary() })
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'p1', goals: 'g', current_ftp: 200, weight_kg: 70,
          weekly_availability: [{ day: 'monday', duration_minutes: 60 }],
          events: [{ name: 'Dragon Ride', date: '2026-09-01', type: 'sportive', priority: 'A' }],
        }),
      })
    })
  }

  it('shows the approval modal when generatePlanInBatches succeeds', async () => {
    (generatePlanInBatches as jest.Mock).mockResolvedValue({
      ok: true,
      plan: {
        rationale: 'r', target_event_name: 'Dragon Ride', target_event_date: '2026-09-01',
        phase: 'base', week_phases: ['base'],
        workouts: [{ date: '2026-06-01', type: 'endurance', duration_minutes: 60, description: 'd', target_zones: 'z', steps: [] }],
      },
    })
    mockProfileAndPlanFetch()

    render(<PlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: /build new plan/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^skip$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /use this approach/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))

    expect(await screen.findByText(/New Training Plan/i)).toBeInTheDocument()
    expect(generatePlanInBatches).toHaveBeenCalledWith(
      6,
      expect.objectContaining({ startDate: expect.any(String), notes: '' }),
      expect.objectContaining({ onTotal: expect.any(Function), onProgress: expect.any(Function) }),
    )
  })

  it('shows the batch failure message on the Training Plan screen when generatePlanInBatches fails', async () => {
    (generatePlanInBatches as jest.Mock).mockResolvedValue({
      ok: false, error: 'Plan generation failed while building weeks 5-8',
    })
    mockProfileAndPlanFetch()

    render(<PlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: /build new plan/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^skip$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /use this approach/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^start$/i }))

    expect(await screen.findByText('Plan generation failed while building weeks 5-8')).toBeInTheDocument()
  })
})
