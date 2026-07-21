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
    deepHistoryBackfilling: false, deepHistoryResult: null, onRunDeepHistoryBackfill: jest.fn(),
    resyncing: false, resyncResult: null, onRunResyncBests: jest.fn(),
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

describe('DailyBriefingCard — deep-history bests backfill button', () => {
  it('renders the button when admin', () => {
    render(<DailyBriefingCard {...makeProps()} />)
    expect(screen.getByRole('button', { name: 'Scan further back in ride history' })).toBeInTheDocument()
  })

  it('calls onRunDeepHistoryBackfill when clicked', () => {
    const onRun = jest.fn()
    render(<DailyBriefingCard {...makeProps({ onRunDeepHistoryBackfill: onRun })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan further back in ride history' }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('shows "Scanning…" and disables the button while running', () => {
    render(<DailyBriefingCard {...makeProps({ deepHistoryBackfilling: true })} />)
    expect(screen.getByRole('button', { name: 'Scanning…' })).toBeDisabled()
  })

  it('shows the result message after a batch completes', () => {
    render(<DailyBriefingCard {...makeProps({ deepHistoryResult: { ok: true, message: 'Scanned back to 1 Jun 2022 — click again to keep going.' } })} />)
    expect(screen.getByText('Scanned back to 1 Jun 2022 — click again to keep going.')).toBeInTheDocument()
  })
})

describe('DailyBriefingCard — resync bests button', () => {
  it('renders the button when admin', () => {
    render(<DailyBriefingCard {...makeProps()} />)
    expect(screen.getByRole('button', { name: 'Resync all-time bests from current rides' })).toBeInTheDocument()
  })

  it('does not render admin resync button for non-admins', () => {
    render(<DailyBriefingCard {...makeProps({ isAdmin: false })} />)
    expect(screen.queryByRole('button', { name: 'Resync all-time bests from current rides' })).not.toBeInTheDocument()
  })

  it('calls onRunResyncBests when clicked', () => {
    const onRun = jest.fn()
    render(<DailyBriefingCard {...makeProps({ onRunResyncBests: onRun })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resync all-time bests from current rides' }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('shows "Resyncing…" and disables the button while running', () => {
    render(<DailyBriefingCard {...makeProps({ resyncing: true })} />)
    expect(screen.getByRole('button', { name: 'Resyncing…' })).toBeDisabled()
  })

  it('shows the result message after completion', () => {
    render(<DailyBriefingCard {...makeProps({ resyncResult: { ok: true, message: 'Resynced from 42 rides — 18 best records written.' } })} />)
    expect(screen.getByText('Resynced from 42 rides — 18 best records written.')).toBeInTheDocument()
  })

  it('warns that resync wipes deep-history coverage found by the scan-further-back button', () => {
    render(<DailyBriefingCard {...makeProps()} />)
    expect(screen.getByText(/wipes any older years found by/i)).toBeInTheDocument()
  })
})
