'use client'

import { useFormStatus } from 'react-dom'

/**
 * Submit button that reflects the pending state of its enclosing form.
 *
 * `useFormStatus` has to be read from a child of the <form>, not from the
 * component that renders it, which is why this is its own component.
 */
export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()

  return (
    <button type="submit" className="btn btn-primary w-100" disabled={pending}>
      {pending && (
        <span
          className="spinner-border spinner-border-sm me-2"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  )
}
