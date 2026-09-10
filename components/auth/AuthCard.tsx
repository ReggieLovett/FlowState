import Link from 'next/link'
import type { ReactNode } from 'react'

/** Shared frame for the sign-in and sign-up screens. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <main id="main" className="auth-shell">
      <div className="w-100" style={{ maxWidth: '25rem' }}>
        <div className="text-center mb-4">
          <Link
            href="/"
            className="d-inline-flex align-items-center gap-2 text-decoration-none"
          >
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-3 bg-primary text-white"
              style={{ width: '2rem', height: '2rem' }}
            >
              <i className="bi bi-calendar2-week" aria-hidden="true" />
            </span>
            <span className="fs-5 fw-semibold text-body">FlowState</span>
          </Link>
        </div>

        <div className="card">
          <div className="card-body p-4">
            <h1 className="h5 fw-semibold mb-1">{title}</h1>
            <p className="text-secondary small mb-4">{subtitle}</p>
            {children}
          </div>
        </div>

        <p className="text-center text-secondary small mt-4 mb-0">{footer}</p>
      </div>
    </main>
  )
}
