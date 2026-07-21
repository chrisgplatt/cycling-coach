import { render, screen, fireEvent } from '@testing-library/react'
import type { ComponentProps } from 'react'
import DailyBriefingCard from '@/components/DailyBriefingCard'

function makeProps(overrides: Partial<ComponentProps<typeof DailyBriefingCard>> = {}): ComponentProps<typeof DailyBriefingCard> {
  return {
    editingBriefing: false, notifTime: '07:00', timezone: 'Europe/London', notificationsEnabled: true,
    isAdmin: true, notifWorking: false, notifError: null, testSending: false, testResult: null,
    saving: false, saved: false, labelClass: '', inputClass: '',
    onNotifTimeChange: jest.fn(), onTimezoneChange: jest.fn(), onStartEditing: jest.fn(),
    onCancelEditing: jest.fn(), onSave: jest.fn(), onToggleNotifications: jest.fn(),
    onSendTestNotification: jest.fn(),
    cronTesting: false, cronTestLogs: null, onRunCronTest: jest.fn(),
    repushing: false, repushResult: null, onRunRepushPlanned: jest.fn(),
    backfilling: false, backfillResult: null, onRunBackfillNotes: jest.fn(),
    zonesFixing: false, zonesResult: null, zonesPreview: null, onPreviewZonesFix: jest.fn(), onApplyZonesFix: jest.fn(),
    ftpBackfilling: false, ftpBackfillResult: null, onRunBackfillFtp: jest.fn(),
    strainBackfilling: false, strainBackfillResult: null, onRunBackfillStrain: jest.fn(),
    metricsBackfilling: false, metricsBackfillResult: null, onRunBackfillActivityMetrics: jest.fn(),
    ...overrides,
  }
}

describe('DailyBriefingCard — all-time bests backfill button', () => {
  it('renders the button when admin', () => {
    render(<DailyBriefingCard {...makeProps()} />)
    expect(screen.getByRole('button', { name: 'Backfill all-time bests (climbs & speed)' })).toBeInTheDocument()
  })

  it('does not render admin backfill buttons for non-admins', () => {
    render(<DailyBriefingCard {...makeProps({ isAdmin: false })} />)
    expect(screen.queryByRole('button', { name: 'Backfill all-time bests (climbs & speed)' })).not.toBeInTheDocument()
  })

  it('calls onRunBackfillActivityMetrics when clicked', () => {
    const onRun = jest.fn()
    render(<DailyBriefingCard {...makeProps({ onRunBackfillActivityMetrics: onRun })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Backfill all-time bests (climbs & speed)' }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('shows "Backfilling…" and disables the button while running', () => {
    render(<DailyBriefingCard {...makeProps({ metricsBackfilling: true })} />)
    const button = screen.getByRole('button', { name: 'Backfilling…' })
    expect(button).toBeDisabled()
  })

  it('shows the result message after completion', () => {
    render(<DailyBriefingCard {...makeProps({ metricsBackfillResult: { ok: true, message: '12 of 12 rides backfilled.' } })} />)
    expect(screen.getByText('12 of 12 rides backfilled.')).toBeInTheDocument()
  })
})
