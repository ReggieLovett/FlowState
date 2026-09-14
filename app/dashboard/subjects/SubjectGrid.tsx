'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import type { SubjectDTO } from '@/lib/data/subjects'
import { CATEGORY_META } from '@/lib/categories'
import {
  EditSubjectButton,
  FetchDeleteSubjectButton,
} from '@/components/subjects/SubjectActions'
import { SubjectItems, type SubjectItemView } from '@/components/subjects/SubjectItems'
import type { ItemSubjectOption } from '@/components/subjects/ItemFormModal'
import { toggleSubjectArchivedAction } from '@/lib/actions/subjects'

/**
 * Subjects as containers, each holding its tasks, assignments, projects and
 * exams.
 *
 * Deleted subjects are tracked as a set of ids and filtered out of the props,
 * rather than copying the props into state. The copy was frozen at first
 * render, so anything the server revalidated afterwards, such as a new item,
 * never reached the screen until a full reload.
 */
export function SubjectGrid({
  subjects,
  itemsBySubject,
  subjectOptions,
  todayISO,
  archived = false,
}: {
  subjects: SubjectDTO[]
  itemsBySubject: Record<string, SubjectItemView[]>
  subjectOptions: ItemSubjectOption[]
  todayISO: string
  archived?: boolean
}) {
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set())

  const handleDeleted = useCallback((id: string) => {
    setDeleted((current) => new Set(current).add(id))
  }, [])

  const rows = subjects.filter((subject) => !deleted.has(subject.id))

  return (
    <div className="row g-3">
      {rows.map((subject) => (
        <div key={subject.id} className={archived ? 'col-12 col-md-6 col-xl-4' : 'col-12 col-xl-6'}>
          <SubjectCard
            subject={subject}
            items={itemsBySubject[subject.id] ?? []}
            subjectOptions={subjectOptions}
            todayISO={todayISO}
            archived={archived}
            onDeleted={handleDeleted}
          />
        </div>
      ))}
    </div>
  )
}

function SubjectCard({
  subject,
  items,
  subjectOptions,
  todayISO,
  archived,
  onDeleted,
}: {
  subject: SubjectDTO
  items: SubjectItemView[]
  subjectOptions: ItemSubjectOption[]
  todayISO: string
  archived: boolean
  onDeleted: (id: string) => void
}) {
  const meta = CATEGORY_META[subject.category]
  const isArchived = archived || Boolean(subject.archivedAt)
  const self: ItemSubjectOption = {
    id: subject.id,
    name: subject.name,
    colorHex: subject.colorHex,
    difficulty: subject.difficulty,
  }

  return (
    <article
      id={`subject-${subject.id}`}
      className={`card h-100 subject-card${isArchived ? ' opacity-75' : ''}`}
      style={{ ['--subject-color' as string]: subject.colorHex }}
    >
      <div className="card-body pb-2">
        <div className="d-flex align-items-start justify-content-between gap-2">
          <div className="min-width-0">
            <h3 className="h6 fw-semibold mb-1 text-truncate d-flex align-items-center gap-2">
              <span className="category-dot" style={{ ['--dot-color' as string]: subject.colorHex }} aria-hidden="true" />
              {subject.name}
            </h3>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="chip">{meta.label}</span>
              {subject.code && <span className="text-secondary small tnum">{subject.code}</span>}
              <span className="chip" title="Difficulty feeds the planner's priority and effort suggestions">
                Difficulty {subject.difficulty}/10
              </span>
              {subject.seedKey && (
                <span className="chip" title="Created with your account">
                  Template
                </span>
              )}
            </div>
          </div>

          <div className="d-flex align-items-center gap-1 flex-shrink-0">
            <form action={toggleSubjectArchivedAction}>
              <input type="hidden" name="id" value={subject.id} />
              <input type="hidden" name="archived" value={isArchived ? 'false' : 'true'} />
              <button
                type="submit"
                className="btn btn-sm btn-outline-secondary"
                title={isArchived ? 'Make active' : 'Archive'}
                aria-label={isArchived ? `Restore ${subject.name}` : `Archive ${subject.name}`}
              >
                <i className={`bi ${isArchived ? 'bi-arrow-up-circle' : 'bi-archive'}`} aria-hidden="true" />
              </button>
            </form>

            <EditSubjectButton subject={subject} />
            <FetchDeleteSubjectButton subject={subject} onDeleted={onDeleted} />
          </div>
        </div>

        {subject.notes && <p className="text-secondary small mt-2 mb-0">{subject.notes}</p>}
      </div>

      <div className="border-top">
        <SubjectItems
          subject={self}
          subjects={subjectOptions}
          items={items}
          todayISO={todayISO}
          disabled={isArchived}
        />
      </div>

      <div className="card-footer bg-transparent d-flex align-items-center justify-content-between small text-secondary">
        <span className="tnum">
          {subject._count.events} {subject._count.events === 1 ? 'calendar event' : 'calendar events'}
        </span>
        {!isArchived && items.some((i) => i.status === 'TODO') && (
          <Link href="/dashboard/schedule?plan=1" className="text-decoration-none">
            <i className="bi bi-stars me-1" aria-hidden="true" />
            Plan this work
          </Link>
        )}
      </div>
    </article>
  )
}
