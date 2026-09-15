'use client'

import { useSyncExternalStore } from 'react'
import type { RateLimited } from '@/lib/rate-limit-shared'

/**
 * Seconds until a rate limit lifts, re-rendering once a second while it counts.
 *
 * Read as an external store rather than kept in state: the clock is the source
 * of truth, and a setInterval that calls setState would be a second copy of it.
 * The interval only exists while a limit is active, so an idle form costs
 * nothing.
 */

const idle = () => () => {}

function ticking(onChange: () => void) {
  const timer = window.setInterval(onChange, 1000)
  return () => window.clearInterval(timer)
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** Returned while the browser clock is not readable yet: the server render and hydration. */
export const CLOCK_UNKNOWN = -1

export function useRetryCountdown(rateLimit?: RateLimited | null): number {
  const active = Boolean(rateLimit)
  const now = useSyncExternalStore(active ? ticking : idle, nowSeconds, () => 0)
  if (!rateLimit) return 0
  // The server has no business guessing the browser's clock. Saying "unknown"
  // lets the first client render match the server's markup exactly.
  if (now === 0) return CLOCK_UNKNOWN
  return Math.max(0, Math.ceil(rateLimit.retryAt / 1000 - now))
}

/** 42 -> "42s", 125 -> "2:05" */
export function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  return `${m}:${String(seconds % 60).padStart(2, '0')}`
}
