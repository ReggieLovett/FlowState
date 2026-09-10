import Link from 'next/link'

export default function NotFound() {
  return (
    <main id="main" className="auth-shell text-center">
      <div>
        <p className="text-secondary small mb-2">404</p>
        <h1 className="h4 fw-semibold mb-2">That page does not exist</h1>
        <p className="text-secondary mb-4">The link may be out of date.</p>
        <Link href="/dashboard" className="btn btn-primary">
          Back to your dashboard
        </Link>
      </div>
    </main>
  )
}
