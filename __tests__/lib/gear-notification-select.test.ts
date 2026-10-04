import { selectNotification } from '@/lib/gear/notification-select'

const none = { heads_up_notified_at: null, due_notified_at: null }

describe('selectNotification', () => {
  it('sends nothing while ok', () => {
    expect(selectNotification('ok', none)).toEqual({ send: null, setHeadsUp: false, setDue: false })
  })
  it('sends a heads-up at due_soon', () => {
    expect(selectNotification('due_soon', none)).toEqual({ send: 'heads_up', setHeadsUp: true, setDue: false })
  })
  it('does not repeat the heads-up', () => {
    expect(selectNotification('due_soon', { ...none, heads_up_notified_at: 'x' }).send).toBeNull()
  })
  it('sends due at overdue', () => {
    expect(selectNotification('overdue', { ...none, heads_up_notified_at: 'x' }))
      .toEqual({ send: 'due', setHeadsUp: false, setDue: true })
  })
  it('on a jump straight to overdue, sends only due and marks the heads-up as sent', () => {
    expect(selectNotification('overdue', none)).toEqual({ send: 'due', setHeadsUp: true, setDue: true })
  })
  it('does not repeat due', () => {
    expect(selectNotification('overdue', { heads_up_notified_at: 'x', due_notified_at: 'y' }).send).toBeNull()
  })
})
