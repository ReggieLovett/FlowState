'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { CATEGORY_META, CATEGORY_ORDER } from '@/lib/categories'
import { createEventAction, updateEventAction, type ActionState } from '@/lib/actions/schedule'
import { toDateInput, toTimeInput } from '@/lib/format'
import type { ScheduleEventDTO } from '@/lib/data/schedule'

export interface SubjectOption {
  id: string
  name: string
  category: string
  colorHex: string
}

const INITIAL: ActionState = {}

/** 09:00 on the chosen day, or the next whole hour when no day was given. */
function defaultStart(day?: Date): Date {
  if (!day) {
    const next = new Date()
    next.setMinutes(0, 0, 0)
    next.setHours(next.getHours() + 1)
    return next
  }

  const start = new Date(day)
  if (start.getHours() === 0 && start.getMinutes() === 0) start.setHours(9, 0, 0, 0)
  return start
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
      {label}
    </button>
  )
}

/**
 * Create/edit dialog.
 *
 * A plain <dialog> rather than Bootstrap's Modal component: it gives focus
 * trapping, Escape-to-close and the backdrop natively, and does not depend on
 * the Bootstrap JS bundle having finished loading.
 */
export function EventFormModal({
  open,
  onClose,
  subjects,
  event,
  defaultDate,
}: {
  open: boolean
  onClose: () => void
  subjects: SubjectOption[]
  event?: ScheduleEventDTO
  defaultDate?: Date
}) {
  const isEdit = Boolean(event)
  const [state, formAction] = useActionState(
    isEdit ? updateEventAction : createEventAction,
    INITIAL,
  )
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [allDay, setAllDay] = useState(event?.isAllDay ?? false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // The action returns { ok: true } once the write has landed.
  useEffect(() => {
    if (state.ok) onClose()
  }, [state.ok, onClose])

  // A new event on a chosen day arrives as that day at local midnight, which is
  // a useless default start time. Fall back to a plausible working hour instead;
  // an existing event keeps its own times.
  const start = event?.startsAt ?? defaultStart(defaultDate)
  const end = event?.endsAt ?? new Date(start.getTime() + 60 * 60 * 1000)

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="border-0 rounded-3 p-0 bg-body text-body"
      style={{ width: 'min(32rem, 92vw)' }}
      aria-label={isEdit ? 'Edit event' : 'New event'}
    >
      <form action={formAction}>
        {isEdit && <input type="hidden" name="id" value={event!.id} />}

        <div className="d-flex align-items-center justify-content-between border-bottom px-4 py-3">
          <h2 className="h6 fw-semibold mb-0">{isEdit ? 'Edit event' : 'New event'}</h2>
          <button
            type="button"
            className="btn-close"
            aria-label="Close"
            onClick={onClose}
          />
        </div>

        <div className="p-4">
          {state.error && (
            <div className="alert alert-danger py-2 px-3 small" role="alert">
              {state.error}
            </div>
          )}

          <div className="mb-3">
            <label htmlFor="title" className="form-label small fw-medium">
              Title
            </label>
            <input
              id="title"
              name="title"
              className="form-control"
              required
              maxLength={200}
              defaultValue={event?.title}
              placeholder="Distributed Systems lecture"
            />
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-sm-6">
              <label htmlFor="category" className="form-label small fw-medium">
                Category
              </label>
              <select
                id="category"
                name="category"
                className="form-select"
                defaultValue={event?.category ?? 'LECTURE'}
              >
                {CATEGORY_ORDER.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_META[category].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-12 col-sm-6">
              <label htmlFor="subjectId" className="form-label small fw-medium">
                Subject
              </label>
              <select
                id="subjectId"
                name="subjectId"
                className="form-select"
                defaultValue={event?.subject?.id ?? ''}
              >
                <option value="">No subject</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-check mb-3">
            <input
              id="isAllDay"
              name="isAllDay"
              type="checkbox"
              className="form-check-input"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            <label htmlFor="isAllDay" className="form-check-label small">
              All day (use for deadlines and hand-offs)
            </label>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-sm-4">
              <label htmlFor="date" className="form-label small fw-medium">
                Date
              </label>
              <input
                id="date"
                name="date"
                type="date"
                className="form-control"
                required
                defaultValue={toDateInput(start)}
              />
            </div>
            <div className="col-6 col-sm-4">
              <label htmlFor="startTime" className="form-label small fw-medium">
                Start
              </label>
              <input
                id="startTime"
                name="startTime"
                type="time"
                className="form-control"
                required={!allDay}
                disabled={allDay}
                defaultValue={toTimeInput(start)}
              />
            </div>
            <div className="col-6 col-sm-4">
              <label htmlFor="endTime" className="form-label small fw-medium">
                End
              </label>
              <input
                id="endTime"
                name="endTime"
                type="time"
                className="form-control"
                required={!allDay}
                disabled={allDay}
                defaultValue={toTimeInput(end)}
              />
            </div>
          </div>

          <div className="mb-3">
            <label htmlFor="location" className="form-label small fw-medium">
              Location
            </label>
            <input
              id="location"
              name="location"
              className="form-control"
              maxLength={200}
              defaultValue={event?.location ?? ''}
              placeholder="Lab 2B, or a meeting link"
            />
          </div>

          <div>
            <label htmlFor="notes" className="form-label small fw-medium">
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              className="form-control"
              rows={2}
              maxLength={2000}
              defaultValue={event?.notes ?? ''}
            />
          </div>
        </div>

        <div className="d-flex justify-content-end gap-2 border-top px-4 py-3 bg-body-tertiary">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            Cancel
          </button>
          <Submit label={isEdit ? 'Save changes' : 'Add event'} />
        </div>
      </form>
    </dialog>
  )
}
