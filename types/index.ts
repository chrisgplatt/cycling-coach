export type WorkoutType = 'endurance' | 'threshold' | 'intervals' | 'recovery'
export type WorkoutStatus = 'planned' | 'completed' | 'skipped' | 'needs_review'
export type PlanStatus = 'active' | 'archived'
export type EventPriority = 'A' | 'B' | 'C'
export type EventType = 'sportive' | 'race' | 'holiday' | 'fitness'
export type PlanPhase = 'base' | 'build' | 'peak' | 'taper'

export interface TrainingEvent {
  name: string
  date: string           // YYYY-MM-DD
  type: EventType
  priority: EventPriority
  icu_event_id?: string  // set when imported from intervals.icu; used for deletion
}

export interface UserProfile {
  id?: number
  full_name?: string
  goals: string
  events: TrainingEvent[]
  weekly_hours?: number       // optional — superseded by weekly_availability
  rest_days?: string[]        // optional — superseded by weekly_availability
  weekly_availability?: Array<{ day: string; duration_minutes: number }>
  min_sessions_per_week?: number
  max_sessions_per_week?: number
  current_ftp: number
  weight_kg: number
  intervals_icu_athlete_id: string
  intervals_icu_api_key: string
  updated_at?: string
  notifications_enabled?: boolean
  notification_time?: string       // HH:MM 24h, e.g. "07:00"
  timezone?: string                // IANA tz, e.g. "Europe/London"
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
  created_at: string
  updated_at: string
}

export interface Workout {
  id: string
  plan_id: string
  date: string
  type: WorkoutType
  duration_minutes: number
  description: string
  target_zones: string
  intervals_icu_event_id: string | null
  status: WorkoutStatus
  icu_activity_id: string | null
  tss: number | null
  missed_reason: string | null
  steps: WorkoutStep[] | null
  created_at: string
}

export interface WorkoutChange {
  workout_id: string
  field: 'duration_minutes' | 'description' | 'type' | 'status'
  old_value: string | number
  new_value: string | number
  reason: string
}

export interface ProposedAdjustment {
  summary: string
  changes: WorkoutChange[]
  workout_steps?: Array<{ workout_id: string; steps: WorkoutStep[] }>
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

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
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
  training_load: number | null   // TSS
  rolling_ftp: number | null     // intervals.icu rolling FTP estimate
  distance: number | null              // metres
  total_elevation_gain: number | null  // metres
  left_right_balance: number | null    // left %, e.g. 52.3
  power_1min?: number | null
  power_5min?: number | null
  power_10min?: number | null
  power_20min?: number | null
}

export interface ICUWellness {
  id: string    // YYYY-MM-DD
  ctl: number | null
  atl: number | null
  form: number | null
  hrv: number | null
  resting_hr: number | null
  sleep_secs: number | null
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
  avg_left_right_balance: number | null  // left %, e.g. 52.3
  balance_ride_count: number
  recent_rides: ICUActivity[]
  cross_training: CrossTrainingGroup[]
}

export interface WeeklyTss {
  weekStart: string  // YYYY-MM-DD (Monday of that ISO week)
  tss: number
}

export interface ChartsData {
  wellness: ICUWellness[]
  weeklyTss: WeeklyTss[]
}

export interface ICUPowerCurvePoint {
  secs: number
  watts: number
}

export interface WorkoutStep {
  label: string
  duration_minutes: number
  power_pct_ftp: number  // e.g. 65 = 65% FTP, 115 = 115% FTP
  cadence?: number
}

// Claude structured output types
export interface GeneratedPlan {
  rationale: string
  target_event_name: string
  target_event_date: string
  phase: PlanPhase
  workouts: Array<{
    date: string
    type: WorkoutType
    duration_minutes: number
    description: string
    target_zones: string
    steps: WorkoutStep[]
  }>
}

// Daily briefing
export interface BriefingContext {
  todayWorkout: Workout | null
  workoutCompleted: boolean
  completedRide: {
    name: string
    avg_power: number | null
    weighted_avg_power: number | null
    tss: number | null
    moving_time: number
  } | null
  ctl: number | null
  atl: number | null
  tsb: number | null
  readinessLabel: 'Ready' | 'Moderate' | 'Fatigued' | 'Unknown'
  hrv: number | null
  recentWorkouts: Array<{
    date: string
    type: string
    avg_power: number | null
    tss: number | null
  }>
  upcomingEvents: TrainingEvent[]
  today: string  // YYYY-MM-DD in user's local timezone
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
