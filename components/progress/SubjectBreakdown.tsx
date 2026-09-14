import type { Progress } from '@/lib/gamification'
import { formatMinutes } from '@/lib/format'

interface SubjectMeta {
  id: string
  name: string
  colorHex: string
}

/**
 * Completed hours per subject over the last 30 days.
 *
 * Bars wear the subject's own colour, the one it has on the calendar, so a
 * subject is recognisable across screens; names and values stay in text
 * colours so a pale subject colour never becomes unreadable text.
 */
export function SubjectBreakdown({
  progress,
  subjects,
}: {
  progress: Progress
  subjects: SubjectMeta[]
}) {
  const byId = new Map(subjects.map((s) => [s.id, s]))
  const rows = progress.subjectMinutes.slice(0, 6)
  const max = Math.max(1, ...rows.map((r) => r.minutes))
  const total = progress.subjectMinutes.reduce((sum, r) => sum + r.minutes, 0)

  if (rows.length === 0) {
    return (
      <p className="text-secondary small mb-0">
        Tick off a few blocks and your hours per subject will show up here.
      </p>
    )
  }

  return (
    <>
      <p className="text-secondary small mb-3">
        <span className="fw-semibold text-body">{formatMinutes(total)}</span> completed in the last 30 days
      </p>
      <ul className="list-unstyled mb-0 d-flex flex-column gap-3">
        {rows.map((row) => {
          const subject = row.subjectId ? byId.get(row.subjectId) : undefined
          const name = subject?.name ?? 'No subject'
          return (
            <li key={row.subjectId ?? 'none'}>
              <div className="d-flex align-items-baseline justify-content-between gap-2 mb-1">
                <span className="small text-truncate">{name}</span>
                <span className="small text-secondary flex-shrink-0">{formatMinutes(row.minutes)}</span>
              </div>
              <div className="hbar-track">
                <span
                  className="hbar"
                  style={{
                    width: `${(row.minutes / max) * 100}%`,
                    background: subject?.colorHex ?? 'var(--bs-secondary-color)',
                  }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
