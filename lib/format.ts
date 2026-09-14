/**
 * Presentation helpers.
 *
 * Dates are stored as absolute instants and formatted on the server, so these
 * pin an explicit locale and timezone-free rendering to avoid a server/client
 * mismatch during hydration.
 */

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const LONG_DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

export const formatTime = (date: Date) => TIME.format(date)
export const formatDay = (date: Date) => DAY.format(date)
export const formatLongDay = (date: Date) => LONG_DAY.format(date)

export function formatRange(start: Date, end: Date, isAllDay: boolean): string {
  return isAllDay ? 'All day' : `${formatTime(start)} to ${formatTime(end)}`
}

/** Monday-based start of the week containing `date`, at local midnight. */
export function startOfWeek(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7))
  return result
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** `YYYY-MM-DD` in local time, for date inputs. */
export function toDateInput(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** `HH:mm` in local time, for time inputs. */
export function toTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function relativeDays(target: Date, from = new Date()): string {
  const a = new Date(target).setHours(0, 0, 0, 0)
  const b = new Date(from).setHours(0, 0, 0, 0)
  const days = Math.round((a - b) / 86_400_000)

  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${Math.abs(days)} days ago`
  return `in ${days} days`
}

/** `1h 40m`, `45m`, `0m`. For durations, not clock times. */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (hours === 0) return `${mins}m`
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`
}
