import 'server-only'

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { after, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rateLimitMessage, type RateLimited } from '@/lib/rate-limit-shared'

/**
 * Rate limiting.
 *
 * ---- Algorithm ----
 * Fixed window, one counter row per key, advanced by a single
 * `INSERT ... ON CONFLICT DO UPDATE`. The upsert takes the row lock, so two
 * requests racing on the same key cannot both read "9 of 10" and both pass:
 * the database serialises them and the eleventh sees 11. A fixed window allows
 * up to twice the limit across a window boundary; for abuse protection that is
 * an acceptable price for one round trip and no clock arithmetic in the app.
 *
 * ---- Storage ----
 * Postgres, because this runs on serverless functions and there is no Redis.
 * Process memory would give every warm instance its own allowance. If request
 * volume ever makes the extra query matter, `consume`, `peek` and `resetLimit`
 * are the whole surface to reimplement on Upstash.
 *
 * Kept free of any auth import: auth.ts calls into this file from the
 * credentials check, so importing the session guard here would be a cycle.
 * The signed-in helpers live in lib/rate-limit-user.ts.
 *
 * ---- Failure ----
 * Fails open. If the limiter's query errors, the request proceeds and the error
 * is logged. A limiter outage should not become an application outage; the
 * routes it protects need the same database anyway, so a broken database stops
 * abuse by itself.
 */

export interface RateLimitPolicy {
  /** Prefix for the counter key. Changing it resets every counter for the policy. */
  name: string
  limit: number
  windowMs: number
  /** Plural noun for the message: "Too many sign-in attempts". */
  noun: string
}

const MINUTE = 60_000

/**
 * The policies, from most to least sensitive. Limits are set for a person
 * using the app quickly, not for an average: someone ticking off a day's blocks
 * or dragging a week into shape should never see them. A script will.
 */
export const POLICIES = {
  /** Every sign-in attempt from one IP. Caps password spraying across accounts. */
  signInIp: { name: 'signin-ip', limit: 20, windowMs: 15 * MINUTE, noun: 'sign-in attempts' },
  /**
   * Failed sign-ins against one email, from anywhere. Caps guessing one account
   * from many IPs. Only failures count, and a success clears it, so the owner
   * signing in normally never trips it.
   */
  signInAccount: { name: 'signin-account', limit: 5, windowMs: 15 * MINUTE, noun: 'failed sign-in attempts' },
  /** Sign-up attempts from one IP, including rejected ones, which also slows email probing. */
  register: { name: 'register-ip', limit: 10, windowMs: 60 * MINUTE, noun: 'sign-up attempts' },
  /** Saving or clearing a generated plan: up to 2,000 rows per call. */
  planWrite: { name: 'plan-write', limit: 12, windowMs: 10 * MINUTE, noun: 'plan changes' },
  /** Ticking a block: two full progress reads per call. */
  complete: { name: 'complete', limit: 60, windowMs: MINUTE, noun: 'completions' },
  /** Drag and keyboard moves on the calendar. Generous: holding Alt+Arrow repeats. */
  move: { name: 'move', limit: 180, windowMs: MINUTE, noun: 'moves' },
  /** Every other create, edit and delete a signed-in user makes. */
  write: { name: 'write', limit: 90, windowMs: MINUTE, noun: 'changes' },
  /** Reads through the JSON API, which can return a year of rows per call. */
  apiRead: { name: 'api-read', limit: 60, windowMs: MINUTE, noun: 'requests' },
} as const satisfies Record<string, RateLimitPolicy>

export interface RateLimitResult extends Omit<RateLimited, 'what'> {
  ok: boolean
  limit: number
  remaining: number
}

/**
 * IPs and emails are hashed before they become keys. The counter only needs
 * to recognise a repeat, not to know who it is, and a table of raw addresses is
 * one more thing to leak.
 */
function keyFor(policy: RateLimitPolicy, subject: string): string {
  const digest = createHash('sha256').update(subject.trim().toLowerCase()).digest('hex').slice(0, 40)
  return `${policy.name}:${digest}`
}

function toResult(policy: RateLimitPolicy, count: number, resetMs: number, nowMs: number): RateLimitResult {
  // resetAt is stored to the millisecond while now() carries microseconds, so a
  // fresh window can read as 3000.4ms away; clamp to the window so that sliver
  // never rounds up into a promise longer than the policy itself.
  const windowSeconds = Math.ceil(policy.windowMs / 1000)
  const retryAfterSeconds = Math.min(windowSeconds, Math.max(1, Math.ceil((resetMs - nowMs) / 1000)))
  return {
    ok: count <= policy.limit,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - count),
    retryAfterSeconds,
    // Anchored to this server's clock rather than the database's, since the
    // browser compares it against Date.now().
    retryAt: Date.now() + retryAfterSeconds * 1000,
  }
}

function openResult(policy: RateLimitPolicy): RateLimitResult {
  return {
    ok: true,
    limit: policy.limit,
    remaining: policy.limit,
    retryAfterSeconds: Math.ceil(policy.windowMs / 1000),
    retryAt: Date.now() + policy.windowMs,
  }
}

/** Counts one request against `subject` and says whether it is within the limit. */
export async function consume(policy: RateLimitPolicy, subject: string): Promise<RateLimitResult> {
  const key = keyFor(policy, subject)
  try {
    const rows = await prisma.$queryRaw<{ count: number; resetMs: number; nowMs: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
      VALUES (${key}, 1, now() + make_interval(secs => ${policy.windowMs / 1000}::double precision))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitBucket"."resetAt" <= now() THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitBucket"."resetAt" <= now() THEN EXCLUDED."resetAt"
          ELSE "RateLimitBucket"."resetAt"
        END
      RETURNING
        "count",
        (extract(epoch FROM "resetAt") * 1000)::double precision AS "resetMs",
        (extract(epoch FROM now()) * 1000)::double precision AS "nowMs"
    `
    scheduleSweep()
    const row = rows[0]
    return toResult(policy, Number(row.count), Number(row.resetMs), Number(row.nowMs))
  } catch (error) {
    console.error(`[rate-limit] ${policy.name} consume failed; allowing request`, error)
    return openResult(policy)
  }
}

/** Reads a counter without changing it. */
export async function peek(policy: RateLimitPolicy, subject: string): Promise<RateLimitResult> {
  const key = keyFor(policy, subject)
  try {
    const rows = await prisma.$queryRaw<{ count: number; resetMs: number; nowMs: number }[]>`
      SELECT
        "count",
        (extract(epoch FROM "resetAt") * 1000)::double precision AS "resetMs",
        (extract(epoch FROM now()) * 1000)::double precision AS "nowMs"
      FROM "RateLimitBucket"
      WHERE "key" = ${key}
    `
    const row = rows[0]
    if (!row || Number(row.resetMs) <= Number(row.nowMs)) return openResult(policy)
    return toResult(policy, Number(row.count), Number(row.resetMs), Number(row.nowMs))
  } catch (error) {
    console.error(`[rate-limit] ${policy.name} peek failed; allowing request`, error)
    return openResult(policy)
  }
}

/** Clears a counter, as a successful sign-in does for its account. */
export async function resetLimit(policy: RateLimitPolicy, subject: string): Promise<void> {
  try {
    await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" = ${keyFor(policy, subject)}`
  } catch (error) {
    console.error(`[rate-limit] ${policy.name} reset failed`, error)
  }
}

/**
 * Deletes long-expired windows now and then, after the response has gone.
 * About one request in fifty pays for it, and it never delays the one it rides.
 */
function scheduleSweep() {
  if (Math.random() > 0.02) return
  try {
    after(async () => {
      try {
        await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "resetAt" < now() - interval '1 hour'`
      } catch (error) {
        console.error('[rate-limit] sweep failed', error)
      }
    })
  } catch {
    // Outside a request scope (a script, a test): skip the sweep.
  }
}

// ---------------------------------------------------------------------------
// Request identity
// ---------------------------------------------------------------------------

/**
 * The caller's IP from forwarding headers.
 *
 * Trust assumption: the app sits behind Vercel, which overwrites these headers
 * at its edge, so a client cannot choose its own value. Behind a proxy that
 * passes a client's X-Forwarded-For through untouched, the first entry would be
 * spoofable and the IP-keyed policies would need that proxy's own header.
 */
export function ipFromHeaders(h: Headers): string {
  return (
    h.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip')?.trim() ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    // Local development has no proxy in front of it.
    'local'
  )
}

export async function clientIp(): Promise<string> {
  return ipFromHeaders(await headers())
}

// ---------------------------------------------------------------------------
// Adapters for Server Actions and Route Handlers
// ---------------------------------------------------------------------------

export interface RateLimitedState {
  error: string
  rateLimit: RateLimited
}

export function limitedState(
  policy: RateLimitPolicy,
  result: Pick<RateLimited, 'retryAfterSeconds' | 'retryAt'>,
): RateLimitedState {
  return {
    // The full sentence, for anything that renders `error` without knowing
    // about rate limits, including the page before hydration.
    error: rateLimitMessage(result.retryAfterSeconds, policy.noun),
    rateLimit: { retryAfterSeconds: result.retryAfterSeconds, retryAt: result.retryAt, what: policy.noun },
  }
}

/** The standard IETF draft headers, so API clients can pace themselves. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(result.retryAfterSeconds),
  }
}

/** A 429 carrying `Retry-After` and a body the client can count down from. */
export function tooManyRequests(policy: RateLimitPolicy, result: RateLimitResult) {
  const state = limitedState(policy, result)
  return NextResponse.json(
    { error: state.error, ...state.rateLimit },
    {
      status: 429,
      headers: { 'Retry-After': String(result.retryAfterSeconds), ...rateLimitHeaders(result) },
    },
  )
}
