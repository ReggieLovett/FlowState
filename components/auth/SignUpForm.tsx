'use client'

import { useActionState } from 'react'
import { registerAction, type AuthFormState } from '@/lib/actions/auth'
import { SubmitButton } from './SubmitButton'

const INITIAL: AuthFormState = {}

export function SignUpForm() {
  const [state, formAction] = useActionState(registerAction, INITIAL)

  return (
    <form action={formAction} noValidate>
      {state.error && (
        <div className="alert alert-danger py-2 px-3 small" role="alert">
          {state.error}
        </div>
      )}

      <div className="mb-3">
        <label htmlFor="name" className="form-label small fw-medium">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          className="form-control"
          placeholder="Amara Diallo"
        />
      </div>

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
          autoComplete="new-password"
          required
          minLength={12}
          className="form-control"
          aria-describedby="password-help"
        />
        <div id="password-help" className="form-text small">
          At least 12 characters. Length matters more than symbols.
        </div>
      </div>

      <SubmitButton>Create account</SubmitButton>
    </form>
  )
}
