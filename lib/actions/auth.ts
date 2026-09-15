'use server'

import { AuthError, CredentialsSignin } from 'next-auth'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { RATE_LIMITED_CODE, signIn, signOut } from '@/auth'
import { POLICIES, clientIp, consume, limitedState, peek } from '@/lib/rate-limit'
import type { RateLimited } from '@/lib/rate-limit-shared'

/**
 * Auth form actions.
 *
 * Each returns `{ error }` for the form to render, or redirects on success.
 * Nothing here trusts a `callbackUrl` from the request: an attacker-supplied
 * redirect target after login is an open-redirect, so the destination is fixed.
 */

export interface AuthFormState {
  error?: string
  /** Present when the form was refused for volume; drives the countdown. */
  rateLimit?: RateLimited
}

const credentialsSchema = z.object({
  email: z.email({ message: 'Enter a valid email address.' }),
  password: z.string().min(1, 'Enter your password.'),
})

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details.' }
  }

  try {
    await signIn('credentials', { ...parsed.data, redirectTo: '/dashboard' })
  } catch (error) {
    // signIn throws a redirect on success; Next uses an exception to unwind, so
    // it has to be rethrown rather than swallowed by the catch below.
    if (error instanceof CredentialsSignin && error.code === RATE_LIMITED_CODE) {
      return await signInLimitState(parsed.data.email)
    }
    if (error instanceof AuthError) {
      return error.type === 'CredentialsSignin'
        ? { error: 'Email or password is incorrect.' }
        : { error: 'Could not sign you in. Please try again.' }
    }
    throw error
  }

  return {}
}

/**
 * How long until this sign-in can be retried. authorize() already did the
 * counting, so this only reads both counters and reports the longer wait.
 */
async function signInLimitState(email: string): Promise<AuthFormState> {
  const [byIp, byAccount] = await Promise.all([
    peek(POLICIES.signInIp, await clientIp()),
    peek(POLICIES.signInAccount, email.toLowerCase()),
  ])
  const blocking = [
    // The IP counter was consumed by the refused attempt, so it is over the
    // limit; the account counter is only ever read first, so it blocks at zero.
    { policy: POLICIES.signInIp, blocked: !byIp.ok, result: byIp },
    { policy: POLICIES.signInAccount, blocked: byAccount.remaining === 0, result: byAccount },
  ]
    .filter((entry) => entry.blocked)
    .sort((a, b) => b.result.retryAfterSeconds - a.result.retryAfterSeconds)[0]

  // Both counters may have expired between the refusal and this read; a
  // one-minute wait is a safe thing to tell someone in that case.
  return blocking
    ? limitedState(blocking.policy, blocking.result)
    : limitedState(POLICIES.signInIp, { retryAfterSeconds: 60, retryAt: Date.now() + 60_000 })
}

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100),
  email: z.email({ message: 'Enter a valid email address.' }),
  password: z
    .string()
    // Length is the property that matters. Composition rules push people toward
    // predictable substitutions, so a floor of 12 is used instead.
    .min(12, 'Use at least 12 characters.')
    .max(200),
})

export async function registerAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details.' }
  }

  // Counted after validation here, since the form validates in the browser
  // first and a typo should not spend an attempt. The JSON route counts before
  // validation instead, because nothing in front of it has checked anything.
  const limit = await consume(POLICIES.register, await clientIp())
  if (!limit.ok) return limitedState(POLICIES.register, limit)

  // Reuses the register route, so account creation and template seeding stay in
  // one transaction with one set of rules.
  const { createAccount } = await import('@/lib/data/accounts')
  const result = await createAccount(parsed.data)

  if (!result.ok) return { error: result.error }

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: '/dashboard',
    })
  } catch (error) {
    if (error instanceof AuthError) {
      // The account exists; only the automatic sign-in failed.
      redirect('/login')
    }
    throw error
  }

  return {}
}

export async function signOutAction() {
  await signOut({ redirectTo: '/login' })
}
