import type {
  Workout,
  ActivityMetrics,
  TrainingPlan,
  RidingStats,
  GeneratedPlan,
  PlanArchiveSummary,
} from '@/types'
import type { TrainingSummary } from '@/lib/plan/summary'

export function makeWorkout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: 'w1',
    plan_id: 'p1',
    date: '2026-05-01',
    type: 'endurance',
    duration_minutes: 60,
    description: 'Steady endurance ride',
    target_zones: 'Zone 2 (55-75% FTP)',
    intervals_icu_event_id: null,
    status: 'planned',
    icu_activity_id: null,
    tss: null,
    ftp_at_completion: null,
    actual_duration_minutes: null,
    missed_reason: null,
    optional: false,
    name: null,
    steps: null,
    activity_metrics: null,
    coaching_notes: null,
    created_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

export function makeActivityMetrics(overrides: Partial<ActivityMetrics> = {}): ActivityMetrics {
  return {
    np: 230,
    avg_power: 215,
    max_power: 600,
    avg_hr: 148,
    distance_m: 30000,
    elevation_m: 300,
    lr_balance: 50,
    best_efforts: null,
    intervals: null,
    decoupling_pct: null,
    climbs: null,
    time_in_zone: null,
    shape: null,
    distributions: null,
    effort_periods: null,
    sprints: null,
    speed_bests: null,
    personal_bests: null,
    synced_at: '2026-05-01T10:00:00Z',
    ...overrides,
  }
}

export function makeTrainingPlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: 'plan1',
    name: 'Test Plan',
    status: 'active',
    target_event_name: 'Target Event',
    target_event_date: '2026-07-01',
    phase: 'build',
    rationale: 'Progressive build towards the A event.',
    last_reviewed_week: null,
    plan_weeks: 8,
    week_phases: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    closed_at: null,
    archive_summary: null,
    ...overrides,
  }
}

export function makeArchiveSummary(overrides: Partial<PlanArchiveSummary> = {}): PlanArchiveSummary {
  return {
    startDate: '2026-05-01',
    closedAt: '2026-06-26',
    plannedEndDate: '2026-06-26',
    closedEarly: false,
    totalPlannedSessions: 24,
    totalCompletedSessions: 20,
    totalHours: 30,
    totalTss: 1800,
    ctlStart: 40,
    ctlEnd: 48,
    fitnessChange: 8,
    consistencyPct: 83,
    weeks: [],
    ...overrides,
  }
}

export function makeRidingStats(overrides: Partial<RidingStats> = {}): RidingStats {
  return {
    ride_count: 0,
    total_distance_km: 0,
    total_elevation_m: 0,
    total_duration_secs: 0,
    power_1min: null,
    power_5min: null,
    power_10min: null,
    power_20min: null,
    avg_left_right_balance: null,
    balance_ride_count: 0,
    avg_hr: null,
    max_hr: null,
    recent_rides: [],
    cross_training: [],
    ...overrides,
  }
}

export function makeGeneratedWorkout(
  overrides: Partial<GeneratedPlan['workouts'][number]> = {},
): GeneratedPlan['workouts'][number] {
  return {
    date: '2026-05-13',
    type: 'endurance',
    duration_minutes: 90,
    description: 'Easy Zone 2 ride',
    target_zones: 'Zone 2 (55-75% FTP)',
    steps: [],
    ...overrides,
  }
}

export function makeWeightEntry(overrides: Partial<import('@/types').WeightEntry> = {}): import('@/types').WeightEntry {
  return {
    id: 'we-1',
    date: '2026-06-01',
    weight_kg: 75,
    ...overrides,
  }
}

export function makeTrainingSummary(overrides: Partial<TrainingSummary> = {}): TrainingSummary {
  return {
    windowMonths: 12,
    windowStart: '2025-09-04',
    ridesCompleted: 0,
    hoursTrained: 0,
    weeksWithPlan: 0,
    weeksActive: 0,
    weeksInWindow: 52,
    ctlStart: null,
    ctlEnd: null,
    fitnessChange: null,
    ftpStart: null,
    ftpEnd: null,
    ftpChange: null,
    ftpStartIsPartial: false,
    ...overrides,
  }
}
