/**
 * Rate limit types and wording shared by the server and the browser.
 *
 * No server imports here: client components read `RateLimited` off action
 * state and API responses to run their countdowns.
 */

export interface RateLimited {
  /** Seconds until the window resets, as the server saw it. */
  retryAfterSeconds: number
  /**
   * The reset instant in epoch milliseconds. The browser counts down to this
   * with its own clock, so the wait keeps shrinking while the message is on
   * screen rather than freezing at whatever the server said.
   */
  retryAt: number
  /** Plural noun for what was limited, e.g. "sign-in attempts". */
  what: string
}

/** "45 seconds", "1 minute", "14 minutes". Rounded up: never promise early. */
export function formatWait(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds))
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`
  const m = Math.ceil(s / 60)
  return `${m} ${m === 1 ? 'minute' : 'minutes'}`
}

export function rateLimitMessage(seconds: number, what = 'requests'): string {
  return `Too many ${what}. Try again in ${formatWait(seconds)}.`
}

/** The JSON body every 429 from an API route carries. */
export interface RateLimitBody extends RateLimited {
  error: string
}

export function isRateLimitBody(value: unknown): value is RateLimitBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RateLimitBody).retryAt === 'number' &&
    typeof (value as RateLimitBody).retryAfterSeconds === 'number'
  )
}
