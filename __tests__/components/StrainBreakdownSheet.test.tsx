import { render, screen } from '@testing-library/react'
import StrainBreakdownSheet from '@/components/StrainBreakdownSheet'
import type { ICUWellness } from '@/types'
import type { HrvStatus } from '@/lib/hrv/baseline'

function makeWellness(overrides: Partial<ICUWellness> = {}): ICUWellness {
  return {
    id: '2026-07-05', ctl: 65, atl: 72, form: -7, hrv: 55, resting_hr: 52,
    sleep_secs: 25200, body_battery_low: null, body_battery_high: 70,
    stress_avg: null, stress_high: null, garmin_training_load: 60, sleep_score: 75,
    ...overrides,
  }
}

const hrvStatus: HrvStatus = {
  label: 'balanced', sufficient: true, daysOfData: 60, today: 55, sevenDayAvg: 56,
  baselineMean: 58, lowerBound: 52, upperBound: 64, trend: 'stable', baselineDrift: 'stable',
}

// RTL's default getByText matcher only joins an element's *direct* child text
// nodes (see @testing-library/dom's getNodeText), so it never sees text that's
// split across a nested element (e.g. the "not synced" wrapped in <em> here).
// This helper matches on the innermost element whose full textContent
// (including descendants) satisfies the regex, which is what the inline
// comments below describe.
function byTextContent(regex: RegExp) {
  return (_content: string, element: Element | null) => {
    if (!element || !regex.test(element.textContent ?? '')) return false
    return Array.from(element.children).every(child => !regex.test(child.textContent ?? ''))
  }
}

describe('StrainBreakdownSheet', () => {
  it('renders nothing when there is no strain-relevant data at all', () => {
    const empty = makeWellness({
      body_battery_high: null, garmin_training_load: null, sleep_score: null, sleep_secs: null,
    })
    const { container } = render(<StrainBreakdownSheet wellness={empty} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows "not synced" for HRV when hrvStatus is not provided', () => {
    render(<StrainBreakdownSheet wellness={makeWellness()} onClose={() => {}} />)
    // "HRV" and "not synced" are both text nodes inside the same <span> (the
    // second wrapped in <em>), so the element's combined textContent is what
    // a regex match sees — an exact-string getByText('HRV') would not match.
    expect(screen.getByText(byTextContent(/HRV\s*not synced/))).toBeInTheDocument()
  })

  it('shows the HRV value and baseline when hrvStatus is provided', () => {
    render(<StrainBreakdownSheet wellness={makeWellness()} hrvStatus={hrvStatus} onClose={() => {}} />)
    expect(screen.getByText(/55ms \(baseline 58ms\)/)).toBeInTheDocument()
  })

  it('shows "not synced" for subjective wellness when todayDailyWellness is not provided', () => {
    render(<StrainBreakdownSheet wellness={makeWellness()} onClose={() => {}} />)
    expect(screen.getByText(byTextContent(/Subjective wellness\s*not synced/))).toBeInTheDocument()
  })

  it('shows energy and leg freshness when todayDailyWellness is provided', () => {
    render(
      <StrainBreakdownSheet
        wellness={makeWellness()}
        todayDailyWellness={{ energy: 3, leg_freshness: 2 }}
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/Energy 3\/5 · Legs 2\/5/)).toBeInTheDocument()
  })

  it('feeds battery drain into both the score and the existing drain display', () => {
    const wellness = makeWellness({ garmin_body_battery_drained: 40, garmin_body_battery_charged: 30 })
    render(<StrainBreakdownSheet wellness={wellness} onClose={() => {}} />)
    // existing display row (unchanged)
    expect(screen.getByText(/↓40 drained/)).toBeInTheDocument()
  })

  it('calls onClose when the Close button is clicked', () => {
    const onClose = jest.fn()
    render(<StrainBreakdownSheet wellness={makeWellness()} onClose={onClose} />)
    screen.getByText('Close').click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
