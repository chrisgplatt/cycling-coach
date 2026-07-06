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

describe('EventDetailModal — multi-day holiday', () => {
  it('shows the date range in the header for a multi-day event', () => {
    renderModal({ name: 'Ski Trip', type: 'holiday', priority: 'C', date: dateOffset(5), end_date: dateOffset(12) } as TrainingEvent)
    expect(screen.getByText(`${dateOffset(5)} – ${dateOffset(12)}`)).toBeInTheDocument()
  })

  it('hides the result-assignment section for a holiday event', () => {
    renderModal({ name: 'Ski Trip', type: 'holiday', priority: 'C', date: dateOffset(5), end_date: dateOffset(12) } as TrainingEvent)
    expect(screen.queryByText('Assign completed ride')).not.toBeInTheDocument()
  })

  it('hides the "Assign ride" / "Cancel" footer buttons for a holiday event with no result', () => {
    renderModal({ name: 'Ski Trip', type: 'holiday', priority: 'C', date: dateOffset(5), end_date: dateOffset(12) } as TrainingEvent)
    expect(screen.queryByRole('button', { name: 'Assign ride' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('hides the "Change ride" / "Remove result" footer buttons for a holiday event with a result assigned', () => {
    renderModal({ name: 'Ski Trip', type: 'holiday', priority: 'C', date: dateOffset(5), end_date: dateOffset(12), icu_activity_id: 'act1' } as TrainingEvent)
    expect(screen.queryByRole('button', { name: 'Change ride' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove result' })).toBeNull()
  })

  it('treats a multi-day holiday as still editable until its end date passes', () => {
    renderModal({ name: 'Ski Trip', type: 'holiday', priority: 'C', date: dateOffset(-5), end_date: dateOffset(2) } as TrainingEvent)
    expect(screen.getByRole('button', { name: 'Edit event' })).toBeInTheDocument()
  })

  it('treats a multi-day holiday as done once its end date has passed', () => {
    renderModal({ name: 'Ski Trip', type: 'holiday', priority: 'C', date: dateOffset(-12), end_date: dateOffset(-5) } as TrainingEvent)
    expect(screen.queryByRole('button', { name: 'Edit event' })).toBeNull()
  })
})
