import type { TriggerStatus } from '@/lib/gear/usage'

export interface NotifyDecision {
  send: 'heads_up' | 'due' | null
  setHeadsUp: boolean
  setDue: boolean
}

export function selectNotification(
  status: TriggerStatus,
  sent: { heads_up_notified_at: string | null; due_notified_at: string | null },
): NotifyDecision {
  if (status === 'overdue' && !sent.due_notified_at) {
    return { send: 'due', setHeadsUp: !sent.heads_up_notified_at, setDue: true }
  }
  if (status === 'due_soon' && !sent.heads_up_notified_at) {
    return { send: 'heads_up', setHeadsUp: true, setDue: false }
  }
  return { send: null, setHeadsUp: false, setDue: false }
}
