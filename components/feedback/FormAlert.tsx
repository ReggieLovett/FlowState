'use client'

import type { RateLimited } from '@/lib/rate-limit-shared'
import { CLOCK_UNKNOWN, formatCountdown, useRetryCountdown } from './useRetryCountdown'

/**
 * The error slot every form shares.
 *
 * A rate limit is not an ordinary failure: nothing is wrong with what the user
 * typed, they only need to wait. So it gets a warning tone and a live countdown
 * instead of a red box with a frozen number, and it says so plainly once the
 * wait is over rather than leaving a stale refusal on screen.
 */
export function FormAlert({
  error,
  rateLimit,
  className = '',
}: {
  error?: string
  rateLimit?: RateLimited
  className?: string
}) {
  const secondsLeft = useRetryCountdown(rateLimit)

  if (rateLimit) {
    // Before hydration: the server's own sentence, which already names a wait.
    if (secondsLeft === CLOCK_UNKNOWN) {
      return (
        <div className={`alert alert-warning py-2 px-3 small d-flex align-items-start gap-2 ${className}`} role="alert">
          <i className="bi bi-hourglass-split mt-1" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )
    }

    const waiting = secondsLeft > 0
    return (
      <div
        className={`alert ${waiting ? 'alert-warning' : 'alert-secondary'} py-2 px-3 small d-flex align-items-start gap-2 ${className}`}
        role={waiting ? 'alert' : 'status'}
      >
        <i className={`bi ${waiting ? 'bi-hourglass-split' : 'bi-arrow-repeat'} mt-1`} aria-hidden="true" />
        <span>
          {waiting ? (
            <>
              Too many {rateLimit.what}. Try again in{' '}
              {/* The alert role announces the sentence once; the ticking
                  number is not re-read every second. */}
              <span className="fw-semibold tnum" aria-live="off">
                {formatCountdown(secondsLeft)}
              </span>
              .
            </>
          ) : (
            'You can try again now.'
          )}
        </span>
      </div>
    )
  }

  if (!error) return null

  return (
    <div className={`alert alert-danger py-2 px-3 small ${className}`} role="alert">
      {error}
    </div>
  )
}

/**
 * True while a rate limit is still counting down, for disabling submit buttons.
 * False while the clock is unknown, so a page that never hydrates (no
 * JavaScript) is not left with a button that can never be pressed again.
 */
export function useRateLimitActive(rateLimit?: RateLimited): boolean {
  return useRetryCountdown(rateLimit) > 0
}
