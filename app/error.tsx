'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Server errors reach the client as an opaque digest; log it so the entry
    // can be matched against the server logs.
    console.error(error)
  }, [error])

  return (
    <main id="main" className="auth-shell text-center">
      <div>
        <h1 className="h4 fw-semibold mb-2">Something went wrong</h1>
        <p className="text-secondary mb-4">
          Your data was not affected. Try loading the page again.
        </p>
        <button type="button" className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        {error.digest && (
          <p className="text-secondary small mt-4 mb-0 tnum">Reference: {error.digest}</p>
        )}
      </div>
    </main>
  )
}
