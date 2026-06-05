import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import AthleteModel from '@/components/AthleteModel'
import type { AthleteBelief } from '@/types'

function belief(over: Partial<AthleteBelief>): AthleteBelief {
  return {
    id: 'b', user_id: 'u', key: 'ramp_tolerance', label: 'Weekly ramp tolerance',
    value_text: 'Absorbs +8%/week.', value_data: null, confidence: 'high', evidence: '10 weeks',
    source: 'computed', status: 'active', first_observed: '', last_updated: '', last_confirmed: null,
    revisions: [], contradiction: null, ...over,
  }
}

afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockReset?.() })

it('renders qualifying beliefs and hides low-confidence ones', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, json: async () => ({ beliefs: [belief({}), belief({ key: 'x', label: 'Low one', confidence: 'low' })] }),
  }) as unknown as typeof fetch
  render(<AthleteModel />)
  await waitFor(() => expect(screen.getByTestId('athlete-model')).toBeInTheDocument())
  expect(screen.getByText('Weekly ramp tolerance')).toBeInTheDocument()
  expect(screen.queryByText('Low one')).not.toBeInTheDocument()
})

it('self-hides when nothing qualifies', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, json: async () => ({ beliefs: [belief({ confidence: 'low' })] }),
  }) as unknown as typeof fetch
  const { container } = render(<AthleteModel />)
  await waitFor(() => expect(container.querySelector('[data-testid="athlete-model"]')).toBeNull())
})

it('Confirm sends a PATCH for that belief', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ beliefs: [belief({})] }) })
    .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  global.fetch = fetchMock as unknown as typeof fetch
  render(<AthleteModel />)
  await waitFor(() => screen.getByText('Confirm'))
  fireEvent.click(screen.getByText('Confirm'))
  await waitFor(() => {
    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(patch).toBeTruthy()
    expect(JSON.parse((patch![1] as RequestInit).body as string)).toMatchObject({ key: 'ramp_tolerance', action: 'confirm' })
  })
})

it('Correct reveals an editor and saves the new wording', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ beliefs: [belief({})] }) })
    .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  global.fetch = fetchMock as unknown as typeof fetch
  render(<AthleteModel />)
  await waitFor(() => screen.getByText('Correct'))
  fireEvent.click(screen.getByText('Correct'))
  const box = await screen.findByRole('textbox')
  fireEvent.change(box, { target: { value: 'My own take.' } })
  fireEvent.click(screen.getByText('Save'))
  await waitFor(() => {
    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(JSON.parse((patch![1] as RequestInit).body as string)).toMatchObject({ action: 'correct', value_text: 'My own take.' })
  })
})
