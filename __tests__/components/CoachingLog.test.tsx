import { render, screen } from '@testing-library/react'
import CoachingLog from '@/components/plan/CoachingLog'
import type { CoachingLogEntry } from '@/types'

const entry = (over: Partial<CoachingLogEntry>): CoachingLogEntry => ({
  id: 'f1', created_at: '2026-06-02T18:00:00Z',
  session_date: '2026-06-02', session_type: 'threshold',
  feedback_text: 'legs felt flat', summary: 'eased Wed intervals',
  approved: true, had_proposal: true, rpe: null, feel: null, ...over,
})

it('renders the empty state when there are no entries', () => {
  render(<CoachingLog entries={[]} />)
  expect(screen.getByTestId('coaching-log')).toBeInTheDocument()
  expect(screen.getByText(/No feedback logged yet/i)).toBeInTheDocument()
})

it('shows applied/dismissed/pending/logged status per entry', () => {
  render(<CoachingLog entries={[
    entry({ id: 'a', approved: true, had_proposal: true }),
    entry({ id: 'b', approved: false, had_proposal: true, summary: '+15min Sun ride' }),
    entry({ id: 'c', approved: null, had_proposal: true, summary: 'review in progress' }),
    entry({ id: 'd', approved: null, had_proposal: false, summary: null }),
  ]} />)
  expect(screen.getByText(/applied/i)).toBeInTheDocument()
  expect(screen.getByText(/dismissed/i)).toBeInTheDocument()
  expect(screen.getByText(/… pending/i)).toBeInTheDocument()
  expect(screen.getByText(/logged/i)).toBeInTheDocument()
})

it('shows the feedback text and adaptation summary', () => {
  render(<CoachingLog entries={[entry({})]} />)
  expect(screen.getByText('legs felt flat')).toBeInTheDocument()
  expect(screen.getByText(/eased Wed intervals/)).toBeInTheDocument()
})
