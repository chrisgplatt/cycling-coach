import type { WorkoutStatus } from '@/types'

interface CountableSession {
  status: WorkoutStatus
  optional?: boolean
}

export function isSessionCountable(w: CountableSession): boolean {
  return !w.optional || w.status === 'completed' || w.status === 'needs_review'
}

export function isSessionCompleted(w: CountableSession): boolean {
  return w.status === 'completed' || (!!w.optional && w.status === 'needs_review')
}
