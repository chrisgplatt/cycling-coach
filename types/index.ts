export type WorkoutType = 'endurance' | 'threshold' | 'intervals' | 'recovery' | 'test'
export type WorkoutStatus = 'planned' | 'completed' | 'skipped' | 'needs_review'
export type PlanStatus = 'active' | 'archived'
export type EventPriority = 'A' | 'B' | 'C'
export type EventType = 'sportive' | 'race' | 'holiday' | 'fitness'
export type EventRPE = 'race_pace' | 'high' | 'medium' | 'low'
export type RaceType = 'road_race' | 'criterium' | 'time_trial' | 'cyclocross'
export type UnavailabilityType = 'sick' | 'injury' | 'holiday' | 'unavailable'
export type PlanPhase = 'base' | 'build' | 'peak' | 'taper'

export interface UnavailabilityPeriod {
  id: string
  type: UnavailabilityType
  start_date: string     // YYYY-MM-DD
  end_date: string       // YYYY-MM-DD (inclusive)
  notes?: string
  impact_plan: boolean
  icu_event_id?: string
}

export interface TrainingEvent {
  name: string
  date: string           // YYYY-MM-DD
  end_date?: string      // YYYY-MM-DD, inclusive — only used by type: 'holiday'; falls back to date when absent
  type: EventType
  priority: EventPriority
  race_type?: RaceType   // only for type === 'race'
  icu_event_id?: string  // set when imported from intervals.icu; used for deletion
  start_time?: string    // HH:MM
  rpe?: EventRPE
  duration_minutes?: number
  distance_km?: number
  continue_training?: boolean  // only for type === 'holiday'; if true, the range is not blocked — sparse optional quality sessions are placed instead
  // Result assignment fields (all optional, written via PATCH /api/events/result)
  icu_activity_id?: string          // linked intervals.icu activity ID
  result_tss?: number               // TSS from the activity
  result_duration_minutes?: number  // actual ride duration in minutes
  result_avg_power?: number         // normalised power (weighted_average_watts)
  result_note?: string              // athlete race reflection
  estimated_tss?: number
}

export interface UserProfile {
  id?: number
  full_name?: string
  date_of_birth?: string | null   // YYYY-MM-DD
  max_hr_manual?: number | null
  observed_max_hr?: number | null
  goals: string
  events: TrainingEvent[]
  unavailability?: UnavailabilityPeriod[]
  weekly_hours?: number       // optional — superseded by weekly_availability
  rest_days?: string[]        // optional — superseded by weekly_availability
  weekly_availability?: Array<{ day: string; duration_minutes: number }>
  min_sessions_per_week?: number
  max_sessions_per_week?: number
  current_ftp: number
  weight_kg: number
  intervals_icu_athlete_id: string
  intervals_icu_api_key: string
  garmin_email?: string
  garmin_last_sync_at?: string | null
  garmin_last_sync_device?: string | null
  updated_at?: string
  notifications_enabled?: boolean
  notification_time?: string       // HH:MM 24h, e.g. "07:00"
  timezone?: string                // IANA tz, e.g. "Europe/London"
  location_label?: string
  latitude?: number
  longitude?: number
}

export interface TrainingPlan {
  id: string
  name: string
  status: PlanStatus
  target_event_name: string
  target_event_date: string
  phase: PlanPhase
  rationale: string
  last_reviewed_week: string | null
  plan_weeks: number | null
  week_phases: PlanPhase[] | null
  created_at: string
  updated_at: string
  closed_at: string | null
  archive_summary: PlanArchiveSummary | null
}

export interface PlanWeekSummary {
  weekIndex: number
  weekStart: string
  plannedSessions: number
  completedSessions: number
  plannedTss: number
  actualTss: number
  hours: number
}

export interface PlanArchiveSummary {
  startDate: string
  closedAt: string
  plannedEndDate: string
  closedEarly: boolean
  totalPlannedSessions: number
  totalCompletedSessions: number
  totalHours: number
  totalTss: number
  ctlStart: number | null
  ctlEnd: number | null
  fitnessChange: number | null
  consistencyPct: number
  weeks: PlanWeekSummary[]
}

export interface CoachingNotes {
  summary: string                              // coach's voice — the session's "why" / principles
  focus: { label: string; detail: string }[]   // adaptive cues (Cadence, Terrain, Execution, …)
}

export interface Workout {
  id: string
  plan_id: string | null  // null for unplanned rides imported from intervals.icu
  date: string
  type: WorkoutType
  duration_minutes: number
  description: string
  target_zones: string
  intervals_icu_event_id: string | null
  status: WorkoutStatus
  icu_activity_id: string | null
  tss: number | null
  ftp_at_completion: number | null  // FTP in effect when this workout/ride was marked completed
  actual_duration_minutes: number | null
  missed_reason: string | null
  optional: boolean  // true for sparse continue-training-holiday sessions — skipping carries no adherence penalty
  name: string | null  // deterministic session name (e.g. "Sa Batalla - 75"); null for un-named/imported workouts
  steps: WorkoutStep[] | null
  activity_metrics: ActivityMetrics | null  // enriched ride detail captured at sync; null until backfilled
  coaching_notes: CoachingNotes | null
  created_at: string
}

export interface WorkoutChange {
  workout_id: string
  field: 'duration_minutes' | 'description' | 'type' | 'status' | 'date'
  old_value: string | number
  new_value: string | number
  reason: string
}

export interface NewWorkoutProposal {
  date: string
  type: WorkoutType
  duration_minutes: number
  description: string
  target_zones: string
  steps: WorkoutStep[]
  reason: string
  optional?: boolean  // true for sparse continue-training-holiday sessions
}

export interface ProposedAdjustment {
  summary: string
  changes: WorkoutChange[]
  workout_steps?: Array<{ workout_id: string; steps: WorkoutStep[] }>
  new_workouts?: NewWorkoutProposal[]
}

export interface SessionWorkoutUpdate {
  type?: WorkoutType
  duration_minutes?: number
  description?: string
  target_zones?: string
}

export interface SessionProposal {
  today_update: SessionWorkoutUpdate
  rationale: string
  week_follow_up?: string
}

export interface SessionWeekProposal {
  changes: WorkoutChange[]
  rationale: string
}

export type FeedbackCompletion = 'as_planned' | 'cut_short' | 'went_harder' | 'modified'
export type FeedbackTag = 'niggle' | 'illness' | 'poor_sleep' | 'mechanical' | 'weather' | 'fuelling'

export interface ReportedSignals {
  rpe?: number | null
  feel?: number | null
  completion?: FeedbackCompletion | null
  tags?: FeedbackTag[] | null
  mood?: number | null
}

export interface SessionFeedback {
  id: string
  workout_id: string | null
  activity_id: string
  feedback_text: string
  activity_tss: number | null
  activity_avg_power: number | null
  activity_avg_hr: number | null
  proposed_adjustment: ProposedAdjustment | null
  approved: boolean | null
  created_at: string
  rpe: number | null
  feel: number | null
  completion: FeedbackCompletion | null
  tags: FeedbackTag[] | null
  mood: number | null
  coach_note: string | null
  coach_note_rating: CoachNoteRating | null
  recommend_adaptations: boolean | null
}

export type CoachNoteRating = 'helpful' | 'not_helpful'

export interface FeedbackMessage {
  id: string
  feedback_id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface CoachingLogEntry {
  id: string
  created_at: string             // when feedback was logged (ISO)
  session_date: string | null    // linked workout date (YYYY-MM-DD), null for manual feedback
  session_type: string | null    // linked workout type, null for manual feedback
  feedback_text: string
  summary: string | null         // proposed_adjustment?.summary ?? null
  approved: boolean | null        // adaptation outcome
  had_proposal: boolean          // proposed_adjustment !== null
  rpe: number | null
  feel: number | null
}

export interface FTPPrediction {
  id: string
  predicted_ftp: number
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  activity_ids: string[]
  confirmed: boolean
  created_at: string
}

export interface PredictionDraft {
  predicted_ftp: number
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  activity_ids: string[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface CoachMessage {
  id: string
  user_id: string
  surface: 'coach' | 'plan' | 'workout' | 'feedback' | 'interview'
  role: 'user' | 'assistant'
  content: string
  context: { workout_id?: string; plan_id?: string; feedback_id?: string } | null
  created_at: string
}

export interface CoachConversationMemory {
  user_id: string
  digest: string
  open_threads: unknown[]
  recurring_concerns: unknown[]
  commitments: unknown[]
  synthesized_at: string
}

// intervals.icu API types
export interface ICUActivity {
  id: string
  start_date_local: string
  type: string
  moving_time: number
  name: string
  average_watts: number | null
  max_watts: number | null
  weighted_average_watts: number | null
  average_heartrate: number | null
  max_heartrate?: number | null
  training_load: number | null   // TSS
  rolling_ftp: number | null     // intervals.icu rolling FTP estimate
  ftp?: number | null            // the FTP intervals.icu actually applied to this activity's calculations (its own FTP history) — distinct from rolling_ftp, which is intervals.icu's algorithmic estimate
  distance: number | null              // metres
  total_elevation_gain: number | null  // metres
  left_right_balance: number | null    // right-side %, e.g. 47.7 (intervals.icu stores right-side %)
  power_1min?: number | null
  power_5min?: number | null
  power_10min?: number | null
  power_20min?: number | null
  elapsed_time?: number | null   // seconds; includes stopped time, unlike moving_time
  max_speed?: number | null      // m/s, raw from API
  average_temp?: number | null   // °C
  min_temp?: number | null       // °C
  max_temp?: number | null       // °C
}

export interface ICUWellness {
  id: string    // YYYY-MM-DD
  ctl: number | null
  atl: number | null
  form: number | null
  hrv: number | null
  resting_hr: number | null
  sleep_secs: number | null
  // Garmin fields (populated when Garmin is connected to intervals.icu)
  body_battery_low: number | null
  body_battery_high: number | null
  stress_avg: number | null
  stress_high: number | null
  garmin_training_load: number | null
  sleep_score: number | null
  // Direct Garmin Connect fields (populated when user connects Garmin in settings)
  garmin_training_readiness?: number | null
  garmin_recovery_time_mins?: number | null
  garmin_training_status?: string | null
  garmin_body_battery_current?: number | null
  garmin_body_battery_charged?: number | null
  garmin_body_battery_drained?: number | null
  garmin_stress_avg_direct?: number | null
  garmin_stress_max?: number | null
  // Sleep/HRV data (from getSleepMetrics)
  garmin_hrv_overnight?: number | null
  garmin_hrv_status?: string | null
  garmin_resting_hr?: number | null
  garmin_sleep_deep_secs?: number | null
  garmin_sleep_light_secs?: number | null
  garmin_sleep_rem_secs?: number | null
  garmin_sleep_awake_secs?: number | null
  garmin_sleep_respiration_avg?: number | null
}

export interface GarminWellness {
  date: string
  garmin_training_readiness: number | null
  garmin_recovery_time_mins: number | null   // minutes until fully recovered
  garmin_training_status: string | null
  garmin_body_battery_current: number | null
  garmin_body_battery_charged: number | null // recharged during sleep
  garmin_body_battery_drained: number | null // drained by today's activity
  garmin_stress_avg: number | null
  garmin_stress_max: number | null           // peak stress of the day
  // Sleep data (from getSleepMetrics)
  garmin_hrv_overnight?: number | null
  garmin_hrv_status?: string | null
  garmin_resting_hr?: number | null
  garmin_sleep_deep_secs?: number | null
  garmin_sleep_light_secs?: number | null
  garmin_sleep_rem_secs?: number | null
  garmin_sleep_awake_secs?: number | null
  garmin_sleep_respiration_avg?: number | null
}

export interface ICUEvent {
  id: string
  category: string   // 'RACE', 'WORKOUT', 'TARGET', 'HOLIDAY', etc.
  name: string
  start_date_local: string  // ISO datetime e.g. "2026-09-14T00:00:00"
}

export interface ICUSyncData {
  activities: ICUActivity[]
  wellness: ICUWellness[]
  athlete_ftp: number | null
  athlete_weight: number | null
  athlete_id?: string  // added by /api/sync route, not by IntervalsClient
  garmin_today?: GarminWellness  // null when Garmin not configured or sync failed
}

export interface CrossTrainingGroup {
  type: string               // e.g. "Walk", "Run", "WeightTraining"
  count: number
  total_duration_secs: number
  total_distance_m: number   // sum of distance in metres; 0 if all null
  total_tss: number          // sum of training_load; 0 if all null
}

export interface RidingStats {
  ride_count: number
  total_distance_km: number
  total_elevation_m: number
  total_duration_secs: number
  power_1min: number | null
  power_5min: number | null
  power_10min: number | null
  power_20min: number | null
  avg_left_right_balance: number | null  // right-side %, e.g. 47.7 (intervals.icu stores right-side %)
  balance_ride_count: number
  avg_hr: number | null
  max_hr: number | null
  recent_rides: ICUActivity[]
  cross_training: CrossTrainingGroup[]
}

export interface WeightEntry {
  id: string
  date: string       // YYYY-MM-DD
  weight_kg: number
}

export interface DailyWellness {
  id: string
  user_id: string
  date: string           // YYYY-MM-DD
  energy: number | null
  leg_freshness: number | null
  mood: number | null
  stress: number | null
  sleep_quality: number | null
  created_at: string
  updated_at: string
}

export interface ProgressDelta {
  current: number
  baseline: number
  delta: number
}

export interface ProgressMetrics {
  ftp: ProgressDelta | null
  ctl: ProgressDelta | null
  weight: ProgressDelta | null
  adherence: { completed: number; total: number } | null
  totalRides: number | null
  planPhase: string | null
  targetEvent: string | null
  targetDate: string | null
  planStartDate: string | null
}

export interface WeeklyProgress {
  sessionsCompleted: number
  sessionsTotal: number
  tssActual: number
  tssPlanned: number
  distanceKm: number
  elevationM: number
  timePlannedMins: number
  timeActualMins: number
  fitnessCtl: number | null
  otherActivitiesCount: number
}

export interface EventCountdown {
  name: string
  daysAway: number
}

export interface WeeklyTss {
  weekStart: string  // YYYY-MM-DD (Monday of that ISO week)
  tss: number
}

export interface RidePoint {
  date: string          // YYYY-MM-DD
  avgHr: number | null
  tss: number | null
  name: string                // activity name, for the ride breakdown tooltip
  durationSecs: number        // from ICUActivity.moving_time
}

export interface DailyStrainPoint {
  date: string
  dailyTrimp: number
  trimpRef: number
  workoutStrain: number
  garminReadiness?: number | null
  garminRecoveryTimeMins?: number | null
  garminBatteryCharged?: number | null
  garminBatteryDrained?: number | null
  garminStressMax?: number | null
}

export interface ActivitySummary {
  date: string           // YYYY-MM-DD
  type: string           // raw intervals.icu type, e.g. "Ride", "Run", "Walk", "WeightTraining"
  distanceM: number | null
  elevationM: number | null
  movingTimeSecs: number
}

export interface RecoveryHistoryPoint {
  date: string
  score: number
  band: 'high' | 'moderate' | 'low'
  explanation: string
  components: {
    sleep: number | null
    hrv: number | null
    wellness: number | null
    tsb: number | null
    bodyBattery: number | null
  }
}

export interface ChartsData {
  wellness: ICUWellness[]
  weeklyTss: WeeklyTss[]
  rides: RidePoint[]
  dailyStrain: DailyStrainPoint[]
  activities: ActivitySummary[]   // all-type activities for last 365 days
  recoveryHistory: RecoveryHistoryPoint[]
}

export interface ICUPowerCurvePoint {
  secs: number
  watts: number
}

export interface ActivityInterval {
  label: string | null
  duration_secs: number
  avg_watts: number | null
  avg_hr: number | null
}

export interface DistributionBin {
  edge: number   // lower edge of the bin; unit implied by context (%FTP, rpm, or bpm)
  secs: number   // seconds spent in this bin
}

export interface SessionDistributions {
  power: DistributionBin[] | null          // 5%-FTP bins, edge 0..150 (150 = "150%+" catch-all)
  power_vi: number | null                  // variability index = NP/avg, 2dp
  power_steady_pct: number | null          // % of moving time within ±5% of NP
  cadence: DistributionBin[] | null        // 10-rpm bins, edge 0..120 (120 = "120+"); coasting excluded
  coasting_secs: number | null             // time pedalling-stopped (<30 rpm)
  hr: DistributionBin[] | null             // 5-bpm bins
  hr_lthr: number | null                   // LTHR used for zone overlay; null = raw bpm
}

export interface ActivityMetrics {
  // Tier 1 — already in the sync payload
  np: number | null            // weighted_average_watts
  avg_power: number | null
  max_power: number | null
  avg_hr: number | null
  max_hr?: number | null
  min_hr?: number | null
  distance_m: number | null
  elevation_m: number | null   // total_elevation_gain
  lr_balance: number | null    // left %
  elapsed_secs?: number | null   // seconds; includes stopped time
  max_speed_ms?: number | null   // m/s, raw from API
  is_indoor?: boolean            // true for trainer/virtual rides (ICU type === 'VirtualRide'); absent (not false) on rides enriched before this field existed — treat undefined as false everywhere it's read
  avg_temp_c?: number | null
  min_temp_c?: number | null
  max_temp_c?: number | null
  // Tier 2 — power-curve best efforts, sampled to canonical durations
  best_efforts: Array<{ secs: number; watts: number }> | null
  // Tier 3 — detected intervals (laps)
  intervals: ActivityInterval[] | null
  // Tier 4 — stream-derived coaching insights (computed at sync from full-resolution streams)
  decoupling_pct: number | null            // aerobic decoupling %, positive = faded
  climbs: ClimbSegment[] | null
  time_in_zone: { z1: number; z2: number; z3: number; z4: number; z5: number; z6: number } | null  // seconds per zone
  shape: Array<{ label: string; planned_w: number; actual_w: number }> | null  // structured rides only
  distributions: SessionDistributions | null  // Tier-4 within-session histograms
  // Tier 5 — ride highlights (climbs reuse Tier 4's `climbs`; these three are new)
  effort_periods: EffortPeriod[] | null    // sustained Z4+ blocks
  sprints: RideSprint[] | null             // 5s/15s best-effort power, no location data
  speed_bests: SpeedBest[] | null          // fastest-over-distance splits (1/5/10/20km)
  personal_bests: PersonalBest[] | null    // 90-day rolling PBs, anchored on this ride's date
  metrics_version?: number  // computation version; drives one-time backfill refresh
  synced_at: string
}

export interface ClimbSegment {
  start_km: number
  duration_secs: number
  elev_gain_m: number
  avg_watts: number | null
  vam: number            // vertical ascent metres / hour
  length_km: number      // climb's actual distance covered
  path: [number, number][] | null   // simplified polyline (max 12 points), null for indoor/no-GPS rides
}

export interface EffortPeriod {
  start_km: number
  duration_secs: number
  avg_watts: number
  zone: 'z4' | 'z5' | 'z6'
}

export interface RideSprint {
  duration_secs: number   // 5 or 15
  watts: number
}

export interface PersonalBest {
  duration_secs: number   // one of the canonical best-effort durations (5,15,60,300,600,1200,3600)
  watts: number
  window_days: number     // 90
}

export interface SpeedBest {
  distance_km: number      // 1, 5, 10, or 20
  avg_speed_kmh: number
  start_km: number         // where along the ride this split began
  duration_secs: number
}

export interface RideStreams {
  time: number[]                       // seconds from start
  distance: number[]                   // metres
  latlng: [number, number][] | null    // null for indoor rides
  power: number[] | null
  hr: number[] | null
  altitude: number[] | null
  cadence: number[] | null
  velocity: number[] | null            // m/s
}

export interface WorkoutStep {
  label: string
  duration_minutes: number
  power_pct_ftp: number  // e.g. 65 = 65% FTP, 115 = 115% FTP
  cadence?: number
}

export interface WeatherSummary {
  temp_min_c: number
  temp_max_c: number
  precip_prob_pct: number   // daily max precipitation probability (0–100)
  wind_max_kph: number      // daily max sustained wind
  gust_max_kph: number      // daily max wind gust
  weather_code: number      // WMO weather interpretation code
  description: string        // human label derived from weather_code
  wind_direction_deg?: number // dominant daily wind direction (meteorological: where wind comes FROM)
}

export interface ActivityWeather {
  activity_id:        string
  temp_min_c:         number
  temp_max_c:         number
  precip_mm:          number
  wind_avg_kph:       number
  wind_dir_deg:       number
  headwind_pct:       number
  tailwind_pct:       number
  crosswind_pct:      number
  air_speed_kph:      number
  weather_impact_pct: number
}

export interface GeocodeMatch {
  label: string
  latitude: number
  longitude: number
}

// Claude structured output types
export interface GeneratedPlan {
  rationale: string
  target_event_name: string
  target_event_date: string
  phase: PlanPhase
  week_phases?: PlanPhase[]
  workouts: Array<{
    date: string
    type: WorkoutType
    duration_minutes: number
    description: string
    target_zones: string
    steps: WorkoutStep[]
    coaching_notes?: CoachingNotes
    optional?: boolean  // true for sparse continue-training-holiday sessions
  }>
}

// Daily briefing
export interface CompletedRideData {
  name: string
  avg_power: number | null
  weighted_avg_power: number | null
  tss: number | null
  moving_time: number
  elevation_m: number | null
  execution: string | null
}

export interface BriefingContext {
  todayWorkout: Workout | null
  todayWorkouts?: Workout[]           // all of today's planned/completed workouts
  todayEvent?: TrainingEvent | null   // event scheduled for today (race, sportive, etc.)
  workoutCompleted: boolean
  completedRide: CompletedRideData | null
  completedRides?: CompletedRideData[] | null  // all completed rides today
  completedRideWeather?: ActivityWeather | null
  ctl: number | null
  atl: number | null
  tsb: number | null
  readinessLabel: 'Ready' | 'Moderate' | 'Fatigued' | 'Unknown'
  hrv: number | null
  hrvStatus?: import('@/lib/hrv/baseline').HrvStatus | null
  dailyStrain: number | null
  strainTargetLow: number | null
  strainTargetHigh: number | null
  strainHistory?: Array<{ date: string; strain: number | null }>
  recentWorkouts: Array<{
    date: string
    type: string
    avg_power: number | null
    tss: number | null
  }>
  upcomingEvents: TrainingEvent[]
  upcomingWorkouts?: Array<{ date: string; type: string; duration_minutes: number; description: string }>
  activeUnavailability?: Array<{ type: string; end_date: string; notes?: string }>
  today: string  // YYYY-MM-DD in user's local timezone
  weather?: WeatherSummary | null
  // Garmin Connect signals (all optional — absent when Garmin not connected)
  garminTrainingReadiness?: number | null
  garminRecoveryTimeMins?: number | null
  garminTrainingStatus?: string | null
  garminBodyBatteryCurrent?: number | null
  garminBodyBatteryCharged?: number | null
  garminBodyBatteryDrained?: number | null
  garminStressAvg?: number | null
  garminStressMax?: number | null
  garminRestingHr?: number | null
  garminSleepDeepSecs?: number | null
  garminSleepLightSecs?: number | null
  garminSleepRemSecs?: number | null
  garminSleepAwakeSecs?: number | null
  garminSleepRespirationAvg?: number | null
  // Composite recovery score (computed from HRV + sleep + wellness + TSB + body battery)
  recoveryScore?: number | null
  recoveryBand?: 'high' | 'moderate' | 'low' | null
  recoveryExplanation?: string
  recoveryStreakDays?: number
  maxHr?: number | null
  dossier?: {
    synthesized_at: string
    content: {
      as_rider?: string
      strengths?: string[]
      weaknesses?: string[]
      training_compliance?: string
      recovery_profile?: string
      event_performance?: string
      trajectory?: string
    }
    explicit_notes: Array<{ note: string; added_at: string }>
  } | null
  athleteModel?: string  // pre-formatted formatAthleteModel() output; '' or undefined when empty
  currentPhase?: string | null       // e.g. 'base' | 'build' | 'peak' | 'taper'
  currentPhaseWeek?: number | null   // which week within the current phase (1-based)
  recentWellness?: DailyWellness[]
}

export interface DailyBriefing {
  id: string
  user_id: string
  date: string
  coach_note: string
  notification_sent_at: string | null
  generated_at: string
}

export interface PushSubscriptionRecord {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}

export type BeliefConfidence = 'low' | 'medium' | 'high'
export type BeliefSource = 'ai' | 'athlete' | 'computed'
export type BeliefStatus = 'active' | 'confirmed' | 'corrected' | 'dismissed' | 'superseded'

export interface BeliefRevision {
  value_text: string
  confidence: BeliefConfidence
  evidence: string
  revised_at: string   // ISO timestamp
  reason: string       // why it changed
}

export interface BeliefContradiction {
  observed: string     // what fresh evidence suggests, conflicting with an athlete-set belief
  noted_at: string     // ISO timestamp
}

export interface AthleteBelief {
  id: string
  user_id: string
  key: string
  label: string
  value_text: string
  value_data: Record<string, unknown> | null
  confidence: BeliefConfidence
  evidence: string
  source: BeliefSource
  status: BeliefStatus
  first_observed: string
  last_updated: string
  last_confirmed: string | null
  revisions: BeliefRevision[]
  contradiction: BeliefContradiction | null
}

export interface TrainingPhilosophy {
  name: string
  label: string
  phase_weeks: { base: number; build: number; peak: number; taper: number }
  intensity_profile: 'polarised-base' | 'threshold-heavy' | 'simplified'
  weekly_hours_at_creation: number
  rationale: string
}
