'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  generateSchedule,
  summarise,
  scheduleWarnings,
  type SchedulingSubject,
  type SchedulingPrefs,
} from '@/lib/scheduling'
import { confirmScheduleAction, type ConfirmState } from '@/lib/actions/scheduling'
import type { Category } from '@prisma/client'

/** Serialised subject as passed from server components. */
interface SerialSubject {
  id: string
  name: string
  category: Category
  colorHex: string
  difficulty: number
  examDate: string | null
}

/** Serialised event as passed from server components. */
interface SerialEvent {
  id: string
  subjectId: string | null
  startsAt: string
  endsAt: string
  isAllDay: boolean
  status: string
}

type RangeKey = 'week' | 'fortnight' | 'month'

const RANGES: Record<RangeKey, { label: string; days: number }> = {
  week: { label: 'This week', days: 6 },
  fortnight: { label: 'Next two weeks', days: 13 },
  month: { label: 'Next four weeks', days: 27 },
}

const DEFAULT_PREFS: SchedulingPrefs = {
  dailyGoalMinutes: 180,
  blockDuration: 50,
  breakDuration: 10,
  breakAfterBlocks: 3,
  dayStartHour: 9,
  dayEndHour: 21,
  studyDays: [1, 2, 3, 4, 5], // Mon-Fri
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`
}

function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function ConfirmButton({ count }: { count: number }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending || count === 0}>
      {pending && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
      <i className="bi bi-magic me-1" aria-hidden="true" />
      Schedule {count} {count === 1 ? 'block' : 'blocks'}
    </button>
  )
}

export function GenerateScheduleDialog({
  open,
  onClose,
  subjects,
  events,
  weekStartISO,
}: {
  open: boolean
  onClose: () => void
  subjects: SerialSubject[]
  events: SerialEvent[]
  weekStartISO: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [range, setRange] = useState<RangeKey>('week')
  const [prefs, setPrefs] = useState<SchedulingPrefs>(DEFAULT_PREFS)
  const [state, formAction] = useActionState(confirmScheduleAction, {} as ConfirmState)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (state.ok) onClose()
  }, [state.ok, onClose])

  // Convert serialised events back to Date objects for the engine
  const existingEvents = useMemo(
    () =>
      events.map((e) => ({
        ...e,
        startsAt: new Date(e.startsAt),
        endsAt: new Date(e.endsAt),
      })),
    [events],
  )

  // Convert serialised subjects back for the engine
  const schedulingSubjects: SchedulingSubject[] = useMemo(
    () =>
      subjects.map((s) => ({
        ...s,
        examDate: s.examDate ? new Date(s.examDate) : null,
      })),
    [subjects],
  )

  const startDate = toISODate(new Date(weekStartISO))
  // Adjust for offset — weekStartISO is already offset by the page
  const endDate = (() => {
    const d = new Date(weekStartISO)
    d.setDate(d.getDate() + RANGES[range].days)
    return toISODate(d)
  })()

  const preview = useMemo(() => {
    const generated = generateSchedule(
      schedulingSubjects,
      existingEvents,
      startDate,
      endDate,
      prefs,
    )
    return {
      generated,
      summary: summarise(generated, schedulingSubjects),
      warnings: scheduleWarnings(generated, schedulingSubjects, startDate),
    }
  }, [schedulingSubjects, existingEvents, startDate, endDate, prefs])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Serialize the blocks as JSON into a hidden input
    const form = e.currentTarget
    const blocksInput = form.elements.namedItem('blocks') as HTMLInputElement
    const serializable = preview.generated.map((b) => ({
      subjectId: b.subjectId,
      title: `${b.subjectName} — Study block`,
      category: b.category,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      isAllDay: false,
    }))
    blocksInput.value = JSON.stringify(serializable)
    form.requestSubmit()
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="border-0 rounded-3 p-0 bg-body text-body"
      style={{ width: 'min(36rem, 92vw)' }}
      aria-label="Generate schedule"
    >
      <form action={formAction} onSubmit={handleSubmit}>
        <input type="hidden" name="blocks" value="[]" />

        <div className="d-flex align-items-center justify-content-between border-bottom px-4 py-3">
          <h2 className="h6 fw-semibold mb-0">
            <i className="bi bi-magic me-2" aria-hidden="true" />
            Generate a plan
          </h2>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>

        <div className="p-4">
          {state.error && (
            <div className="alert alert-danger py-2 px-3 small" role="alert">
              {state.error}
            </div>
          )}

          {subjects.length === 0 ? (
            <p className="text-secondary small mb-0">
              Add subjects with difficulty ratings and exam dates first. The
              generator uses those to prioritise your study time.
            </p>
          ) : (
            <>
              {/* Range selector */}
              <div className="mb-3">
                <label htmlFor="gen-range" className="form-label small fw-medium">
                  Date range
                </label>
                <select
                  id="gen-range"
                  className="form-select form-select-sm"
                  value={range}
                  onChange={(e) => setRange(e.target.value as RangeKey)}
                >
                  {Object.entries(RANGES).map(([key, { label }]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Preferences */}
              <div className="row g-3 mb-4">
                <div className="col-6 col-sm-4">
                  <label htmlFor="gen-daily" className="form-label small fw-medium">
                    Daily goal
                  </label>
                  <div className="input-group input-group-sm">
                    <input
                      id="gen-daily"
                      type="number"
                      className="form-control"
                      min={30}
                      max={600}
                      step={15}
                      value={prefs.dailyGoalMinutes}
                      onChange={(e) =>
                        setPrefs({ ...prefs, dailyGoalMinutes: Number(e.target.value) })
                      }
                    />
                    <span className="input-group-text">min</span>
                  </div>
                </div>
                <div className="col-6 col-sm-4">
                  <label htmlFor="gen-block" className="form-label small fw-medium">
                    Block length
                  </label>
                  <div className="input-group input-group-sm">
                    <input
                      id="gen-block"
                      type="number"
                      className="form-control"
                      min={15}
                      max={120}
                      step={5}
                      value={prefs.blockDuration}
                      onChange={(e) =>
                        setPrefs({ ...prefs, blockDuration: Number(e.target.value) })
                      }
                    />
                    <span className="input-group-text">min</span>
                  </div>
                </div>
                <div className="col-6 col-sm-4">
                  <label htmlFor="gen-break" className="form-label small fw-medium">
                    Break
                  </label>
                  <div className="input-group input-group-sm">
                    <input
                      id="gen-break"
                      type="number"
                      className="form-control"
                      min={0}
                      max={30}
                      step={5}
                      value={prefs.breakDuration}
                      onChange={(e) =>
                        setPrefs({ ...prefs, breakDuration: Number(e.target.value) })
                      }
                    />
                    <span className="input-group-text">min</span>
                  </div>
                </div>
              </div>

              {/* Time split preview */}
              <div className="mb-3">
                <div className="d-flex align-items-baseline justify-content-between mb-2">
                  <h3 className="h6 fw-semibold mb-0">Time split</h3>
                  <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
                    {formatDuration(preview.summary.totalMinutes)} across{' '}
                    {preview.summary.days} days
                  </span>
                </div>

                {preview.summary.bySubject.length === 0 ? (
                  <p className="text-secondary small mb-0 py-3 text-center border rounded">
                    Nothing fits in this range. Try widening the study window or
                    adding more study days.
                  </p>
                ) : (
                  <ul className="list-unstyled mb-0">
                    {preview.summary.bySubject.map(
                      ({ subject, minutes, blocks: count }) => {
                        const share = minutes / preview.summary.totalMinutes
                        return (
                          <li key={subject.id} className="mb-2">
                            <div className="d-flex align-items-baseline justify-content-between mb-1">
                              <span className="small text-truncate">{subject.name}</span>
                              <span
                                className="text-secondary flex-shrink-0 ms-2"
                                style={{ fontSize: '0.75rem' }}
                              >
                                {formatDuration(minutes)} · {count} blocks
                              </span>
                            </div>
                            <div
                              className="progress"
                              style={{ height: '4px' }}
                              role="progressbar"
                              aria-valuenow={Math.round(share * 100)}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${subject.name}: ${formatDuration(minutes)}`}
                            >
                              <div
                                className="progress-bar"
                                style={{
                                  width: `${share * 100}%`,
                                  backgroundColor: subject.colorHex,
                                }}
                              />
                            </div>
                          </li>
                        )
                      },
                    )}
                  </ul>
                )}
              </div>

              {/* Warnings */}
              {preview.warnings.length > 0 && (
                <div className="alert alert-warning py-2 px-3 small mb-0">
                  <div className="fw-medium mb-1">
                    <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
                    Worth a look
                  </div>
                  <ul className="mb-0 ps-3">
                    {preview.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="d-flex justify-content-end gap-2 border-top px-4 py-3 bg-body-tertiary">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            Cancel
          </button>
          <ConfirmButton count={preview.generated.length} />
        </div>
      </form>
    </dialog>
  )
}
