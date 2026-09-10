import type { ReactNode } from 'react'

/** Shown when a surface has no rows. Always names the next action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="text-center py-5 px-3">
      <div
        className="d-inline-flex align-items-center justify-content-center rounded-circle border bg-body-tertiary text-secondary mb-3"
        style={{ width: '2.75rem', height: '2.75rem' }}
      >
        <i className={`bi ${icon}`} aria-hidden="true" />
      </div>
      <h3 className="h6 fw-semibold mb-1">{title}</h3>
      <p className="text-secondary small mb-0 mx-auto" style={{ maxWidth: '34rem' }}>
        {description}
      </p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
