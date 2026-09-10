'use client'

import { useActionState } from 'react'
import { signInAction, type AuthFormState } from '@/lib/actions/auth'
import { SubmitButton } from './SubmitButton'

const INITIAL: AuthFormState = {}

export function SignInForm() {
  const [state, formAction] = useActionState(signInAction, INITIAL)

  return (
    <form action={formAction} noValidate>
      {state.error && (
        <div className="alert alert-danger py-2 px-3 small" role="alert">
          {state.error}
        </div>
      )}

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

      <SubmitButton>Sign in</SubmitButton>
    </form>
  )
}
