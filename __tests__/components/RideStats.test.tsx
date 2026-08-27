import { render, screen } from '@testing-library/react'
import RideStats, { rideStatsFromActivity, rideStatsFromMetrics } from '@/components/RideStats'
import type { ICUActivity, ActivityMetrics } from '@/types'

const activity: ICUActivity = {
  id: 'a1', start_date_local: '2026-05-20T07:00:00', type: 'Ride', moving_time: 3600,
  name: 'Morning Ride', average_watts: 200, max_watts: 350, weighted_average_watts: 210,
  average_heartrate: 145, training_load: 85, rolling_ftp: null, distance: 30000,
  total_elevation_gain: 320, left_right_balance: 52, power_1min: 380, power_5min: 320,
  power_10min: 300, power_20min: 280,
}

const metrics: ActivityMetrics = {
  np: 210, avg_power: 200, max_power: 350, avg_hr: 145, distance_m: 30000, elevation_m: 320,
  lr_balance: 52, best_efforts: [
    { secs: 5, watts: 900 }, { secs: 15, watts: 650 }, { secs: 60, watts: 380 },
    { secs: 300, watts: 320 }, { secs: 1200, watts: 280 }, { secs: 3600, watts: 220 },
  ],
  intervals: null, decoupling_pct: null, climbs: null, time_in_zone: null, shape: null, distributions: null,
  effort_periods: null, sprints: null, speed_bests: null, personal_bests: null, synced_at: '',
}

describe('RideStats adapters', () => {
  it('maps an ICUActivity', () => {
    const d = rideStatsFromActivity(activity)
    expect(d).toMatchObject({
      avgWatts: 200, np: 210, tss: 85, distanceM: 30000, elevationM: 320,
      durationSecs: 3600, avgHr: 145, lrBalanceRight: 52,
      best: { p5s: null, p15s: null, p1: 380, p5: 320, p10: 300, p20: 280, p60min: null },
    })
  })

  it('maps an ICUActivity, filling 5s/15s/60min from a supplied best_efforts list', () => {
    const d = rideStatsFromActivity(activity, [{ secs: 5, watts: 900 }, { secs: 15, watts: 650 }, { secs: 3600, watts: 220 }])
    expect(d.best).toMatchObject({ p5s: 900, p15s: 650, p1: 380, p5: 320, p10: 300, p20: 280, p60min: 220 })
  })

  it('maps ActivityMetrics, looking up best efforts by secs and tolerating gaps', () => {
    const d = rideStatsFromMetrics(metrics, 3600, 85)
    expect(d).toMatchObject({
      avgWatts: 200, np: 210, tss: 85, distanceM: 30000, elevationM: 320,
      durationSecs: 3600, avgHr: 145, lrBalanceRight: 52,
      best: { p5s: 900, p15s: 650, p1: 380, p5: 320, p10: null, p20: 280, p60min: 220 }, // 600s effort absent → null
    })
  })
})

describe('RideStats render', () => {
  it('shows power, totals, HR and L/R', () => {
    render(<RideStats data={rideStatsFromActivity(activity)} />)
    expect(screen.getByText('NP')).toBeInTheDocument()
    expect(screen.getByText('210')).toBeInTheDocument()  // NP watts
    expect(screen.getByText('1h 0m')).toBeInTheDocument() // duration
    expect(screen.getByText('Avg HR')).toBeInTheDocument()
    expect(screen.getByText(/L \/ /)).toBeInTheDocument()  // balance text
  })

  it('hides Best Power, HR and L/R cards when their data is absent', () => {
    const d = rideStatsFromActivity({ ...activity, average_heartrate: null, left_right_balance: null,
      power_1min: null, power_5min: null, power_10min: null, power_20min: null })
    render(<RideStats data={d} />)
    expect(screen.queryByText('Best Power')).toBeNull()
    expect(screen.queryByText('Heart Rate')).toBeNull()
    expect(screen.queryByText('L/R Balance')).toBeNull()
  })

  it('shows 5s, 15s and 60min best power cells alongside 1/5/10/20 min', () => {
    const d = rideStatsFromMetrics(metrics, 3600, 85)
    render(<RideStats data={d} />)
    expect(screen.getByText('5 sec')).toBeInTheDocument()
    expect(screen.getByText('900')).toBeInTheDocument()
    expect(screen.getByText('15 sec')).toBeInTheDocument()
    expect(screen.getByText('650')).toBeInTheDocument()
    expect(screen.getByText('60 min')).toBeInTheDocument()
    expect(screen.getByText('220')).toBeInTheDocument()
  })

  it('shows the Best Power card with placeholders when only some durations are present', () => {
    const d = rideStatsFromActivity(activity) // p5s/p15s/p60min null, p1/p5/p10/p20 present
    render(<RideStats data={d} />)
    expect(screen.getByText('Best Power')).toBeInTheDocument()
    expect(screen.getByText('5 sec')).toBeInTheDocument()
    expect(screen.getByText('60 min')).toBeInTheDocument()
  })

  it('shows "% of Max HR" when effectiveMaxHr is provided', () => {
    // The `activity` fixture has no max_heartrate set — override it explicitly.
    const withMaxHr = rideStatsFromActivity({ ...activity, max_heartrate: 171 })
    render(<RideStats data={withMaxHr} effectiveMaxHr={190} />)
    expect(screen.getByText('% of Max')).toBeInTheDocument()
    expect(screen.getByText('90')).toBeInTheDocument() // round(171/190*100) = 90
  })

  it('does not show "% of Max HR" when effectiveMaxHr is absent', () => {
    const withMaxHr = rideStatsFromActivity({ ...activity, max_heartrate: 171 })
    render(<RideStats data={withMaxHr} />)
    expect(screen.queryByText('% of Max')).not.toBeInTheDocument()
  })
})

describe('RideStats adapters — speed, elapsed time, temperature', () => {
  it('derives average speed from distance and moving time, and maps max speed / elapsed / temperature from an ICUActivity', () => {
    const d = rideStatsFromActivity({
      ...activity, moving_time: 3600, distance: 36000,
      elapsed_time: 3720, max_speed: 15.5, average_temp: 18, min_temp: 14, max_temp: 22,
    })
    expect(d.avgSpeedKph).toBeCloseTo(36, 5)
    expect(d.maxSpeedKph).toBeCloseTo(55.8, 1)
    expect(d.elapsedSecs).toBe(3720)
    expect(d.avgTempC).toBe(18)
    expect(d.minTempC).toBe(14)
    expect(d.maxTempC).toBe(22)
  })

  it('nulls speed, elapsed, and temperature fields when absent from an ICUActivity', () => {
    const d = rideStatsFromActivity(activity)
    expect(d.maxSpeedKph).toBeNull()
    expect(d.elapsedSecs).toBeNull()
    expect(d.avgTempC).toBeNull()
    expect(d.minTempC).toBeNull()
    expect(d.maxTempC).toBeNull()
  })

  it('returns null average speed when distance is unavailable', () => {
    const d = rideStatsFromActivity({ ...activity, distance: null })
    expect(d.avgSpeedKph).toBeNull()
  })

  it('derives average speed from distance and the supplied duration, and maps max speed / elapsed / temperature from ActivityMetrics', () => {
    const d = rideStatsFromMetrics({
      ...metrics, distance_m: 36000, max_speed_ms: 15.5,
      elapsed_secs: 3720, avg_temp_c: 18, min_temp_c: 14, max_temp_c: 22,
    }, 3600, 85)
    expect(d.avgSpeedKph).toBeCloseTo(36, 5)
    expect(d.maxSpeedKph).toBeCloseTo(55.8, 1)
    expect(d.elapsedSecs).toBe(3720)
    expect(d.avgTempC).toBe(18)
    expect(d.minTempC).toBe(14)
    expect(d.maxTempC).toBe(22)
  })
})

describe('RideStats render — speed and temperature cards', () => {
  it('shows the Speed card when speed data is present', () => {
    const d = rideStatsFromActivity({ ...activity, max_speed: 15.5 })
    render(<RideStats data={d} />)
    expect(screen.getByText('Speed')).toBeInTheDocument()
    expect(screen.getByText('Avg Speed')).toBeInTheDocument()
    expect(screen.getByText('Max Speed')).toBeInTheDocument()
  })

  it('hides the Speed card when both average and max speed are absent', () => {
    const d = rideStatsFromActivity({ ...activity, distance: null, max_speed: null })
    render(<RideStats data={d} />)
    expect(screen.queryByText('Speed')).toBeNull()
  })

  it('shows the Elapsed stat in Ride Totals when present', () => {
    const d = rideStatsFromActivity({ ...activity, elapsed_time: 3720 })
    render(<RideStats data={d} />)
    expect(screen.getByText('Elapsed')).toBeInTheDocument()
    expect(screen.getByText('1h 2m')).toBeInTheDocument()
  })

  it('hides the Elapsed stat when absent', () => {
    render(<RideStats data={rideStatsFromActivity(activity)} />)
    expect(screen.queryByText('Elapsed')).toBeNull()
  })

  it('shows the Temperature card with only the fields that are present', () => {
    const d = rideStatsFromActivity({ ...activity, average_temp: 18, min_temp: null, max_temp: null })
    render(<RideStats data={d} />)
    expect(screen.getByText('Temperature')).toBeInTheDocument()
    expect(screen.getByText('Avg Temp')).toBeInTheDocument()
    expect(screen.queryByText('Min Temp')).toBeNull()
    expect(screen.queryByText('Max Temp')).toBeNull()
  })

  it('hides the Temperature card when all three values are absent', () => {
    render(<RideStats data={rideStatsFromActivity(activity)} />)
    expect(screen.queryByText('Temperature')).toBeNull()
  })
})
