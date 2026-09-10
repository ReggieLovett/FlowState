import type { Metadata } from 'next'
import { auth } from '@/auth'
import { listSubjects } from '@/lib/data/subjects'
import { signOutAction } from '@/lib/actions/auth'
import { CATEGORY_META, CATEGORY_ORDER } from '@/lib/categories'

export const metadata: Metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const session = await auth()
  const subjects = await listSubjects({ includeArchived: true })

  return (
    <>
      <header className="mb-4">
        <h1 className="h3 fw-semibold mb-1">Settings</h1>
        <p className="text-secondary mb-0">Your account and how the app is set up.</p>
      </header>

      <div className="row g-4">
        <div className="col-12 col-lg-6">
          <div className="card h-100">
            <div className="card-header bg-transparent">
              <h2 className="h6 fw-semibold mb-0">Account</h2>
            </div>
            <div className="card-body">
              <dl className="row mb-0 small">
                <dt className="col-4 text-secondary fw-normal">Name</dt>
                <dd className="col-8">{session?.user?.name ?? 'Not set'}</dd>

                <dt className="col-4 text-secondary fw-normal">Email</dt>
                <dd className="col-8 text-break">{session?.user?.email}</dd>

                <dt className="col-4 text-secondary fw-normal">Subjects</dt>
                <dd className="col-8 tnum mb-0">{subjects.length}</dd>
              </dl>
            </div>
            <div className="card-footer bg-transparent">
              <form action={signOutAction}>
                <button type="submit" className="btn btn-outline-secondary btn-sm">
                  <i className="bi bi-box-arrow-right me-1" aria-hidden="true" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-6">
          <div className="card h-100">
            <div className="card-header bg-transparent">
              <h2 className="h6 fw-semibold mb-0">Categories</h2>
            </div>
            <div className="card-body">
              <p className="text-secondary small mb-3">
                The commitment types available when you create an event.
              </p>
              <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                {CATEGORY_ORDER.map((category) => {
                  const meta = CATEGORY_META[category]
                  return (
                    <li key={category} className="d-flex align-items-start gap-2">
                      <span
                        className="category-dot mt-2"
                        style={{ ['--dot-color' as string]: meta.colorHex }}
                        aria-hidden="true"
                      />
                      <div>
                        <div className="small fw-medium">{meta.label}</div>
                        <div className="text-secondary" style={{ fontSize: '0.75rem' }}>
                          {meta.description}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="card border-danger-subtle">
            <div className="card-header bg-transparent">
              <h2 className="h6 fw-semibold mb-0 text-danger-emphasis">Your data</h2>
            </div>
            <div className="card-body">
              <p className="text-secondary small mb-0">
                Your schedule is private to this account. Nothing you create here is
                visible to any other user. Deleting your account would remove your
                subjects and events with it; that is not exposed in the UI yet.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
