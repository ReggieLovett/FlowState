import type { Metadata } from 'next'
import { listSubjects } from '@/lib/data/subjects'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { NewSubjectButton } from '@/components/subjects/SubjectActions'
import { restoreDefaultsAction } from '@/lib/actions/subjects'
import { SubjectGrid } from './SubjectGrid'

export const metadata: Metadata = { title: 'Subjects' }
export const dynamic = 'force-dynamic'

/**
 * Subject management.
 *
 * Rows created by the sign-up seed appear here alongside the user's own and are
 * edited, archived and deleted through identical controls. Nothing on this page
 * branches on `seedKey` except the "Restore defaults" affordance, which is
 * additive and never overwrites a customised row.
 */
export default async function SubjectsPage() {
  const subjects = await listSubjects({ includeArchived: true })
  const active = subjects.filter((s) => !s.archivedAt)
  const archived = subjects.filter((s) => s.archivedAt)

  return (
    <>
      <header className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4">
        <div>
          <h1 className="h3 fw-semibold mb-1">Subjects</h1>
          <p className="text-secondary mb-0" style={{ maxWidth: '52rem' }}>
            The recurring commitments your schedule is built from. Your account started
            with a set of templates; rename, recolour or delete any of them.
          </p>
        </div>

        <div className="d-flex align-items-center gap-2">
          <form action={restoreDefaultsAction}>
            <button type="submit" className="btn btn-sm btn-outline-secondary">
              <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
              Restore defaults
            </button>
          </form>
          <NewSubjectButton />
        </div>
      </header>

      {active.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="bi-collection"
            title="No active subjects"
            description="Add one, or restore the starter templates you began with."
            action={<NewSubjectButton />}
          />
        </div>
      ) : (
        <SubjectGrid subjects={active} />
      )}

      {archived.length > 0 && (
        <>
          <h2 className="h6 fw-semibold text-secondary mt-5 mb-3">Archived</h2>
          <SubjectGrid subjects={archived} archived />
        </>
      )}
    </>
  )
}
