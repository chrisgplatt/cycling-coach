import { render, screen } from '@testing-library/react'
import EventDetailModal from '@/components/EventDetailModal'
import type { TrainingEvent } from '@/types'

// Dates relative to now so the past/future distinction is stable whenever the
// suite runs.
function dateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

const base = { name: 'Test Race', type: 'race', priority: 'A' } as const

function renderModal(event: TrainingEvent) {
  return render(
    <EventDetailModal
      event={event}
      activitiesOnDate={[]}
      onClose={() => {}}
      onResultSaved={() => {}}
      onEdit={() => {}}
    />,
  )
}

describe('EventDetailModal — done events are read-only', () => {
  it('hides "Edit event" for a past (done) event', () => {
    renderModal({ ...base, date: dateOffset(-10) } as TrainingEvent)
    expect(screen.queryByRole('button', { name: 'Edit event' })).toBeNull()
  })

  it('shows "Edit event" for a future event with no result', () => {
    renderModal({ ...base, date: dateOffset(10) } as TrainingEvent)
    expect(screen.getByRole('button', { name: 'Edit event' })).toBeInTheDocument()
  })

  it('still allows recording a result on a past event (assign ride is shown)', () => {
    renderModal({ ...base, date: dateOffset(-10) } as TrainingEvent)
    // Result-recording stays available even though the event itself can't be edited.
    expect(screen.getByText('Assign completed ride')).toBeInTheDocument()
  })
})
