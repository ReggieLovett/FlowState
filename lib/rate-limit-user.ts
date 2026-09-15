import 'server-only'

import { requireUserId } from '@/lib/auth-guard'
import {
  consume,
  limitedState,
  type RateLimitPolicy,
  type RateLimitResult,
  type RateLimitedState,
} from '@/lib/rate-limit'

/**
 * Per-user limits for Server Actions and Route Handlers.
 *
 * Separate from lib/rate-limit.ts so that file can be imported by auth.ts
 * without a cycle through the session guard.
 */

/**
 * Counts one request for the signed-in user. Returns state for the form to
 * render when over the limit, or null to carry on.
 */
export async function limitUser(policy: RateLimitPolicy): Promise<RateLimitedState | null> {
  const userId = await requireUserId()
  const result = await consume(policy, userId)
  return result.ok ? null : limitedState(policy, result)
}

/** The same count for a known user id, returning the raw result for HTTP headers. */
export async function consumeForUser(policy: RateLimitPolicy, userId: string): Promise<RateLimitResult> {
  return consume(policy, userId)
}
