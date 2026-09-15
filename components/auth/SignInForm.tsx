'use client'

import { useActionState } from 'react'
import { signInAction, type AuthFormState } from '@/lib/actions/auth'
import { FormAlert, useRateLimitActive } from '@/components/feedback/FormAlert'
import { SubmitButton } from './SubmitButton'

const INITIAL: AuthFormState = {}

/**
 * `notice` covers the one refusal that arrives by redirect rather than as
 * action state: a sign-in posted straight to the Auth.js endpoint, which lands
 * back here with ?code=rate_limited and no countdown to offer.
 */
export function SignInForm({ notice }: { notice?: string }) {
  const [state, formAction] = useActionState(signInAction, INITIAL)
  const limited = useRateLimitActive(state.rateLimit)
  // Once this form has an answer of its own, the redirect's notice is stale.
  const answered = state.error !== undefined || state.rateLimit !== undefined

  return (
    <form action={formAction} noValidate>
      {!answered && notice && (
        <div className="alert alert-warning py-2 px-3 small" role="alert">
          {notice}
        </div>
      )}
      <FormAlert error={state.error} rateLimit={state.rateLimit} />

      <div className="mb-3">
        <label htmlFor="email" className="form-label small fw-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="form-control"
          placeholder="you@university.edu"
        />
      </div>

      <div className="mb-4">
        <label htmlFor="password" className="form-label small fw-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="form-control"
        />
      </div>

      <SubmitButton blocked={limited}>Sign in</SubmitButton>
    </form>
  )
}
