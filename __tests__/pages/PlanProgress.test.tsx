import { render, screen } from '@testing-library/react'
import PlanPage from '@/app/plan/page'

const profileData = {
  id: 1, goals: '', current_ftp: 250, weight_kg: 72, weekly_availability: [],
  min_sessions_per_week: 3, max_sessions_per_week: 5,
  events: [{ name: 'Dragon Ride', date: '2026-07-01', type: 'sportive', priority: 'A' }],
  unavailability: [],
}

// Active plan: created 2026-05-01, 3 weeks, with a couple of workouts.
const planResponse = {
  id: 'plan1', name: 'Road to Dragon Ride', status: 'active',
  target_event_name: 'Dragon Ride', target_event_date: '2026-07-01',
  phase: 'build', plan_weeks: 3, week_phases: ['base', 'build', 'peak'],
  created_at: '2026-05-01T00:00:00Z',
  workouts: [
    { id: 'w1', plan_id: 'plan1', date: '2026-05-02', type: 'endurance', duration_minutes: 60,
      description: '', target_zones: '', intervals_icu_event_id: null, status: 'completed',
      icu_activity_id: null, tss: null, missed_reason: null,
      steps: [{ label: 's', duration_minutes: 60, power_pct_ftp: 70 }],
      activity_metrics: null, coaching_notes: null, created_at: '2026-05-01T00:00:00Z' },
    { id: 'w2', plan_id: 'plan1', date: '2026-05-09', type: 'threshold', duration_minutes: 60,
      description: '', target_zones: '', intervals_icu_event_id: null, status: 'planned',
      icu_activity_id: null, tss: null, missed_reason: null,
      steps: [{ label: 's', duration_minutes: 60, power_pct_ftp: 95 }],
      activity_metrics: null, coaching_notes: null, created_at: '2026-05-01T00:00:00Z' },
  ],
}

const syncResponse = {
  activities: [{ id: 'a1', start_date_local: '2026-05-02T08:00:00', type: 'Ride', moving_time: 3600,
    name: 'Ride', average_watts: 200, max_watts: 500, weighted_average_watts: 210,
    average_heartrate: 150, training_load: 55, rolling_ftp: null, distance: null,
    total_elevation_gain: null, left_right_balance: null }],
  wellness: [
    { id: '2026-05-01', ctl: 40, atl: 38, form: 2, hrv: null, resting_hr: null, sleep_secs: null },
    { id: '2026-05-08', ctl: 44, atl: 50, form: -6, hrv: null, resting_hr: null, sleep_secs: null },
    { id: '2026-05-15', ctl: 48, atl: 54, form: -6, hrv: null, resting_hr: null, sleep_secs: null },
  ],
  athlete_ftp: 250, athlete_weight: 72,
}

beforeEach(() => {
  jest.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/profile') return Promise.resolve({ ok: true, json: async () => profileData } as Response)
    if (url === '/api/plan') return Promise.resolve({ ok: true, json: async () => planResponse } as Response)
    if (url === '/api/sync') return Promise.resolve({ ok: true, json: async () => syncResponse } as Response)
    if (url === '/api/feedback') return Promise.resolve({ ok: true, json: async () => ({
      entries: [{
        id: 'f1', created_at: '2026-05-03T18:00:00Z', session_date: '2026-05-02',
        session_type: 'endurance', feedback_text: 'felt strong',
        summary: 'added 15 min', approved: true, had_proposal: true,
      }],
    }) } as Response)
    if (url.includes('/api/plan/history')) return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) } as Response)
    if (url.includes('/api/plan/summary')) return Promise.resolve({ ok: true, json: async () => ({
      windowMonths: 12, windowStart: '2025-09-04',
      ridesCompleted: 0, hoursTrained: 0, weeksWithPlan: 0, weeksInWindow: 52,
      ctlStart: null, ctlEnd: null, fitnessChange: null,
      ftpStart: null, ftpEnd: null, ftpChange: null, ftpStartIsPartial: false,
    }) } as Response)
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
})
afterEach(() => jest.restoreAllMocks())

it('renders the progress modules for an active plan', async () => {
  render(<PlanPage />)
  expect(await screen.findByTestId('plan-journey')).toBeInTheDocument()
  expect(await screen.findByTestId('consistency-strip')).toBeInTheDocument()
  expect(await screen.findByTestId('load-chart')).toBeInTheDocument()
  expect(await screen.findByTestId('fitness-trend')).toBeInTheDocument()
  expect(await screen.findByTestId('coaching-log')).toBeInTheDocument()
  expect(await screen.findByText('felt strong')).toBeInTheDocument()
})
