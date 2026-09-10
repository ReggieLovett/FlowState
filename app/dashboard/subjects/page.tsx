import type { Metadata } from 'next'
import { listSubjects } from '@/lib/data/subjects'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { NewSubjectButton } from '@/components/subjects/SubjectActions'
import { SubjectGrid } from './SubjectGrid'

export const metadata: Metadata = { title: 'Subjects' }
export const dynamic = 'force-dynamic'

/**
 * Subject management.
 *
 * Subjects are created explicitly by the user and managed through the same CRUD
 * controls from the moment they are added.
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
            The recurring commitments your schedule is built from. Add the subjects
            you want to track.
          </p>
        </div>

        <NewSubjectButton />
      </header>

      {active.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="bi-collection"
            title="No active subjects"
            description="Add your first subject to start building your schedule."
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
