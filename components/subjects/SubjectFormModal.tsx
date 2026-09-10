'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { CATEGORY_META, CATEGORY_ORDER } from '@/lib/categories'
import {
  createSubjectAction,
  updateSubjectAction,
} from '@/lib/actions/subjects'
import type { ActionState } from '@/lib/actions/schedule'
import type { SubjectDTO } from '@/lib/data/subjects'

const INITIAL: ActionState = {}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
      {label}
    </button>
  )
}

export function SubjectFormModal({
  open,
  onClose,
  subject,
}: {
  open: boolean
  onClose: () => void
  subject?: SubjectDTO
}) {
  const isEdit = Boolean(subject)
  const [state, formAction] = useActionState(
    isEdit ? updateSubjectAction : createSubjectAction,
    INITIAL,
  )
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [difficulty, setDifficulty] = useState(subject?.difficulty ?? 5)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (state.ok) onClose()
  }, [state.ok, onClose])

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="border-0 rounded-3 p-0 bg-body text-body"
      style={{ width: 'min(30rem, 92vw)' }}
      aria-label={isEdit ? 'Edit subject' : 'New subject'}
    >
      <form action={formAction}>
        {isEdit && <input type="hidden" name="id" value={subject!.id} />}

        <div className="d-flex align-items-center justify-content-between border-bottom px-4 py-3">
          <h2 className="h6 fw-semibold mb-0">{isEdit ? 'Edit subject' : 'New subject'}</h2>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>

        <div className="p-4">
          {state.error && (
            <div className="alert alert-danger py-2 px-3 small" role="alert">
              {state.error}
            </div>
          )}

          <div className="mb-3">
            <label htmlFor="subject-name" className="form-label small fw-medium">
              Name
            </label>
            <input
              id="subject-name"
              name="name"
              className="form-control"
              required
              maxLength={120}
              defaultValue={subject?.name}
              placeholder="Distributed Systems"
            />
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-sm-7">
              <label htmlFor="subject-category" className="form-label small fw-medium">
                Category
              </label>
              <select
                id="subject-category"
                name="category"
                className="form-select"
                defaultValue={subject?.category ?? 'LECTURE'}
              >
                {CATEGORY_ORDER.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_META[category].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-12 col-sm-5">
              <label htmlFor="subject-code" className="form-label small fw-medium">
                Code
              </label>
              <input
                id="subject-code"
                name="code"
                className="form-control"
                maxLength={40}
                defaultValue={subject?.code ?? ''}
                placeholder="CS 4780"
              />
            </div>
          </div>

          <div className="mb-3">
            <label htmlFor="subject-color" className="form-label small fw-medium">
              Colour
            </label>
            <input
              id="subject-color"
              name="colorHex"
              type="color"
              className="form-control form-control-color"
              defaultValue={subject?.colorHex ?? '#1F6F54'}
              title="Used on the schedule"
            />
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-sm-7">
              <label htmlFor="subject-difficulty" className="form-label small fw-medium">
                Difficulty ({difficulty}/10)
              </label>
              <input
                id="subject-difficulty"
                name="difficulty"
                type="range"
                className="form-range"
                min={1}
                max={10}
                step={1}
                value={difficulty}
                onChange={(e) => setDifficulty(Number(e.target.value))}
              />
              <div className="d-flex justify-content-between" style={{ fontSize: '0.7rem' }}>
                <span className="text-secondary">Easy</span>
                <span className="text-secondary">Hard</span>
              </div>
            </div>

            <div className="col-12 col-sm-5">
              <label htmlFor="subject-examDate" className="form-label small fw-medium">
                Exam / deadline
              </label>
              <input
                id="subject-examDate"
                name="examDate"
                type="date"
                className="form-control"
                defaultValue={subject?.examDate ? new Date(subject.examDate).toISOString().slice(0, 10) : ''}
              />
              <div className="form-text">Optional. Drives the smart scheduling priority.</div>
            </div>
          </div>

          <div>
            <label htmlFor="subject-notes" className="form-label small fw-medium">
              Notes
            </label>
            <textarea
              id="subject-notes"
              name="notes"
              className="form-control"
              rows={2}
              maxLength={2000}
              defaultValue={subject?.notes ?? ''}
            />
          </div>
        </div>

        <div className="d-flex justify-content-end gap-2 border-top px-4 py-3 bg-body-tertiary">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            Cancel
          </button>
          <Submit label={isEdit ? 'Save changes' : 'Add subject'} />
        </div>
      </form>
    </dialog>
  )
}
