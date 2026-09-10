import { signOutAction } from '@/lib/actions/auth'

/** Account summary and sign-out. Server-rendered; sign-out is a Server Action. */
export function UserMenu({ name, email }: { name: string | null; email: string }) {
  const initial = (name ?? email).trim().charAt(0).toUpperCase()

  return (
    <div className="d-flex align-items-center gap-2">
      <span
        className="d-none d-sm-inline-flex align-items-center justify-content-center rounded-circle bg-primary-bg-subtle text-primary-emphasis fw-semibold"
        style={{ width: '2rem', height: '2rem', fontSize: '0.8125rem' }}
        aria-hidden="true"
      >
        {initial}
      </span>
      <div className="d-none d-md-block lh-sm me-1">
        <div className="small fw-medium">{name ?? 'Your account'}</div>
        <div className="text-secondary" style={{ fontSize: '0.75rem' }}>
          {email}
        </div>
      </div>
      <form action={signOutAction}>
        <button type="submit" className="btn btn-sm btn-outline-secondary">
          Sign out
        </button>
      </form>
    </div>
  )
}
