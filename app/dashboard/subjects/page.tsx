import type { Metadata } from 'next'
import Link from 'next/link'
import { listSubjects } from '@/lib/data/subjects'
import { listItems } from '@/lib/data/items'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { NewSubjectButton } from '@/components/subjects/SubjectActions'
import type { SubjectItemView } from '@/components/subjects/SubjectItems'
import { toDateInput } from '@/lib/format'
import { SubjectGrid } from './SubjectGrid'

export const metadata: Metadata = { title: 'Subjects' }
export const dynamic = 'force-dynamic'

/** A date-only value stored at UTC midnight, as YYYY-MM-DD. */
const dateOnly = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)

/**
 * Subjects and the work inside them.
 *
 * Each subject is a container for tasks, assignments, projects and exams.
 * Those items are what the smart planner schedules, so the page shows how much
 * of each one's effort is already on the calendar.
 */
export default async function SubjectsPage() {
  const [subjects, items] = await Promise.all([
    listSubjects({ includeArchived: true }),
    listItems(),
  ])
  const active = subjects.filter((s) => !s.archivedAt)
  const archived = subjects.filter((s) => s.archivedAt)
  const now = new Date()

  const itemsBySubject: Record<string, SubjectItemView[]> = {}
  for (const item of items) {
    const minutes = (list: typeof item.events) =>
      list.reduce((sum, e) => sum + (e.endsAt.getTime() - e.startsAt.getTime()) / 60_000, 0)

    const view: SubjectItemView = {
      id: item.id,
      subjectId: item.subjectId,
      title: item.title,
      type: item.type,
      status: item.status,
      dueDate: dateOnly(item.dueDate),
      estimatedMinutes: item.estimatedMinutes,
      priority: item.priority,
      notes: item.notes,
      bookedMinutes: Math.round(minutes(item.events)),
      completedMinutes: Math.round(minutes(item.events.filter((e) => e.status === 'COMPLETED'))),
      upcomingSessions: item.events.filter((e) => e.status === 'SCHEDULED' && e.startsAt > now).length,
    }
    ;(itemsBySubject[item.subjectId] ??= []).push(view)
  }

  const subjectOptions = active.map((s) => ({
    id: s.id,
    name: s.name,
    colorHex: s.colorHex,
    difficulty: s.difficulty,
  }))
  const openCount = items.filter((i) => i.status === 'TODO').length

  return (
    <>
      <header className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4">
        <div>
          <h1 className="h3 fw-semibold mb-1">Subjects</h1>
          <p className="text-secondary mb-0" style={{ maxWidth: '52rem' }}>
            Each subject holds its own tasks, assignments, projects and exams. Add the work
            with a due date and the planner spreads the effort across your calendar.
          </p>
        </div>

        <div className="d-flex align-items-center gap-2">
          {openCount > 0 && (
            <Link href="/dashboard/schedule?plan=1" className="btn btn-outline-primary btn-sm">
              <i className="bi bi-stars me-1" aria-hidden="true" />
              Plan {openCount} open {openCount === 1 ? 'item' : 'items'}
            </Link>
          )}
          <NewSubjectButton />
        </div>
      </header>

      {active.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="bi-collection"
            title="No active subjects"
            description="Add your first subject, then fill it with the exams, assignments and tasks you need to get done."
            action={<NewSubjectButton />}
          />
        </div>
      ) : (
        <SubjectGrid
          subjects={active}
          itemsBySubject={itemsBySubject}
          subjectOptions={subjectOptions}
          todayISO={toDateInput(now)}
        />
      )}

      {archived.length > 0 && (
        <>
          <h2 className="h6 fw-semibold text-secondary mt-5 mb-3">Archived</h2>
          <SubjectGrid
            subjects={archived}
            itemsBySubject={itemsBySubject}
            subjectOptions={subjectOptions}
            todayISO={toDateInput(now)}
            archived
          />
        </>
      )}
    </>
  )
}
