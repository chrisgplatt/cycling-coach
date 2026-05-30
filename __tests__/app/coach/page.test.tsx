import { render, screen } from '@testing-library/react'
import CoachPage from '@/app/coach/page'

jest.mock('@/components/CoachChat', () => ({
  __esModule: true,
  default: () => <div data-testid="coach-chat" />,
}))

const dossier = {
  id: 'd1', user_id: 'u1', synthesized_at: new Date(Date.now() - 2 * 864e5).toISOString(),
  content: {
    as_rider: 'Committed amateur with a strong aerobic base.',
    strengths: ['Z2 compliance'], weaknesses: ['Race pacing'],
    training_compliance: 'Consistent.', recovery_profile: 'Recovers well.',
    event_performance: 'Solid sportives.', trajectory: 'Trending up.',
  },
  explicit_notes: [{ note: 'Knee flares on long climbs', added_at: '2026-05-03T09:00:00Z' }],
  created_at: new Date().toISOString(),
}

function mockFetch(dossierValue: unknown) {
  return jest.fn((url: string) => {
    if (url === '/api/dossier') return Promise.resolve({ ok: true, json: () => Promise.resolve({ dossier: dossierValue }) })
    if (url === '/api/profile') return Promise.resolve({ ok: true, json: () => Promise.resolve({ current_ftp: 250 }) })
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }) as unknown as typeof fetch
}

describe('CoachPage', () => {
  afterEach(() => jest.restoreAllMocks())

  it('renders the dossier report and a remembered note', async () => {
    global.fetch = mockFetch(dossier)
    render(<CoachPage />)
    expect(await screen.findByText(/Committed amateur/)).toBeInTheDocument()
    expect(screen.getByText(/Knee flares on long climbs/)).toBeInTheDocument()
    expect(screen.getByText('Z2 compliance')).toBeInTheDocument()
  })

  it('shows an empty state when there is no dossier yet', async () => {
    global.fetch = mockFetch(null)
    render(<CoachPage />)
    expect(await screen.findByText(/no coach.?s notes yet/i)).toBeInTheDocument()
  })
})
