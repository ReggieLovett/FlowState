/**
 * Wall-clock time in a named timezone, as an absolute instant.
 *
 * The event dialog sends a date and a time as typed ("2026-09-24", "09:00").
 * Those only mean something in the timezone of the person typing them. The
 * server used to read them in its own timezone, which on a laptop happens to be
 * the user's, and on Vercel is UTC: a user in Manila saving 09:00 got 17:00, and
 * re-saving an event unchanged moved it eight hours. The browser now sends its
 * IANA timezone alongside, and this turns the pair into the right instant.
 *
 * No library: the platform's Intl data already knows every zone's offsets and
 * daylight-saving rules, which is the hard part.
 */

/** Milliseconds `timeZone` is ahead of UTC at `instant`. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(instant / 1000) * 1000
}

/**
 * The instant at which it is `time` on `date` in `timeZone`.
 *
 * Starts by pretending the wall time is UTC, then corrects by the zone's offset
 * at that guess. A second pass settles the case where the correction crosses a
 * daylight-saving change. For a time that does not exist (skipped by a spring
 * change) the result lands just after the gap, which is what calendars do.
 */
export function wallTimeToInstant(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, hh, mm)

  let instant = wall
  for (let pass = 0; pass < 2; pass += 1) instant = wall - offsetAt(instant, timeZone)
  return new Date(instant)
}

/** True for a zone name the platform recognises, e.g. "Asia/Manila". */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}
