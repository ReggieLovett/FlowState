'use client'

import { useCallback, useState } from 'react'
import type { SubjectDTO } from '@/lib/data/subjects'
import { CATEGORY_META } from '@/lib/categories'
import {
  EditSubjectButton,
  FetchDeleteSubjectButton,
} from '@/components/subjects/SubjectActions'
import { toggleSubjectArchivedAction } from '@/lib/actions/subjects'

/**
 * Client-side subject grid.
 *
 * Holds the subject list in state so a successful fetch-based delete can
 * remove the card instantly without a full server round-trip, while keeping
 * the server-rendered props as the initial value.
 */
export function SubjectGrid({
  subjects,
  archived = false,
}: {
  subjects: SubjectDTO[]
  archived?: boolean
}) {
  const [rows, setRows] = useState(subjects)

  const handleDeleted = useCallback((id: string) => {
    setRows((current) => current.filter((subject) => subject.id !== id))
  }, [])

  return (
    <div className="row g-3">
      {rows.map((subject) => (
        <div key={subject.id} className="col-12 col-md-6 col-xl-4">
          <SubjectCard subject={subject} archived={archived} onDeleted={handleDeleted} />
        </div>
      ))}
    </div>
  )
}

function SubjectCard({
  subject,
  archived,
  onDeleted,
}: {
  subject: SubjectDTO
  archived: boolean
  onDeleted: (id: string) => void
}) {
  const meta = CATEGORY_META[subject.category]
  const isArchived = archived || Boolean(subject.archivedAt)

  return (
    <article className={`card h-100${isArchived ? ' opacity-75' : ''}`}>
      <div
        style={{ height: '4px', background: subject.colorHex }}
        className="rounded-top"
        aria-hidden="true"
      />
      <div className="card-body d-flex flex-column">
        <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
          <div className="min-width-0">
            <h3 className="h6 fw-semibold mb-1 text-truncate">{subject.name}</h3>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="chip">{meta.label}</span>
              {subject.code && (
                <span className="text-secondary small tnum">{subject.code}</span>
              )}
              {subject.seedKey && (
                <span className="chip" title="Created with your account">
                  Template
                </span>
              )}
            </div>
          </div>
        </div>

        {subject.notes && (
          <p className="text-secondary small mb-3" style={{ minHeight: '2.5rem' }}>
            {subject.notes}
          </p>
        )}

        <div className="d-flex align-items-center justify-content-between gap-2 mt-auto pt-2">
          <span className="text-secondary small tnum">
            {subject._count.events} {subject._count.events === 1 ? 'event' : 'events'}
          </span>

          <div className="d-flex align-items-center gap-1">
            <form action={toggleSubjectArchivedAction}>
              <input type="hidden" name="id" value={subject.id} />
              <input type="hidden" name="archived" value={isArchived ? 'false' : 'true'} />
              <button
                type="submit"
                className="btn btn-sm btn-outline-secondary"
                title={isArchived ? 'Make active' : 'Archive'}
                aria-label={
                  isArchived ? `Restore ${subject.name}` : `Archive ${subject.name}`
                }
              >
                <i
                  className={`bi ${isArchived ? 'bi-arrow-up-circle' : 'bi-archive'}`}
                  aria-hidden="true"
                />
              </button>
            </form>

            <EditSubjectButton subject={subject} />
            <FetchDeleteSubjectButton subject={subject} onDeleted={onDeleted} />
          </div>
        </div>
      </div>
    </article>
  )
}