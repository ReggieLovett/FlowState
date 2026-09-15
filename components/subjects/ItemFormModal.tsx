'use client'

import { Fragment, useActionState, useEffect, useRef, useState } from 'react'
import { FormAlert, useRateLimitActive } from '@/components/feedback/FormAlert'
import { useFormStatus } from 'react-dom'
import { createItemAction, updateItemAction } from '@/lib/actions/items'
import type { ActionState } from '@/lib/actions/schedule'
import { ITEM_LABELS, suggestEstimate, type ItemKind } from '@/lib/scheduling'

export interface ItemSubjectOption {
  id: string
  name: string
  colorHex: string
  difficulty: number
}

/** The fields the form edits, serialisable across the server boundary. */
export interface EditableItem {
  id: string
  subjectId: string
  title: string
  type: ItemKind
  /** YYYY-MM-DD or null. */
  dueDate: string | null
  estimatedMinutes: number | null
  priority: number
  notes: string | null
}

const TYPES: ItemKind[] = ['TASK', 'ASSIGNMENT', 'PROJECT', 'EXAM']
const PRIORITIES = [
  { value: 1, label: 'Low' },
  { value: 2, label: 'Normal' },
  { value: 3, label: 'High' },
]

const INITIAL: ActionState = {}

export function formatEffort(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function Submit({ label, blocked = false }: { label: string; blocked?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending || blocked}>
      {pending && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
      {label}
    </button>
  )
}

/**
 * Create or edit a subject item.
 *
 * Effort is optional on purpose. Left blank, the planner suggests one from the
 * type and the subject's difficulty, and the form shows that suggestion as the
 * placeholder so the user sees what "blank" will mean before saving.
 */
export function ItemFormModal({
  open,
  onClose,
  subjects,
  subjectId,
  item,
  defaultType = 'TASK',
}: {
  open: boolean
  onClose: () => void
  subjects: ItemSubjectOption[]
  subjectId?: string
  item?: EditableItem
  defaultType?: ItemKind
}) {
  const isEdit = Boolean(item)
  const [state, formAction] = useActionState(isEdit ? updateItemAction : createItemAction, INITIAL)
  // Locks the submit button for the length of a rate limit; the alert says why.
  const limited = useRateLimitActive(state.rateLimit)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const [type, setType] = useState<ItemKind>(item?.type ?? defaultType)
  const [subject, setSubject] = useState(item?.subjectId ?? subjectId ?? subjects[0]?.id ?? '')
  const [hours, setHours] = useState(
    item?.estimatedMinutes ? String(Math.round((item.estimatedMinutes / 60) * 100) / 100) : '',
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (state.ok) onClose()
  }, [state.ok, onClose])

  const difficulty = subjects.find((s) => s.id === subject)?.difficulty ?? 5
  const suggestion = suggestEstimate(type, difficulty)
  const prefix = isEdit ? 'edit-item' : 'new-item'

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="border-0 rounded-3 p-0 bg-body text-body"
      style={{ width: 'min(34rem, 94vw)' }}
      aria-label={isEdit ? 'Edit item' : 'New item'}
    >
      <form action={formAction}>
        {isEdit && <input type="hidden" name="id" value={item!.id} />}
        <input type="hidden" name="type" value={type} />

        <div className="d-flex align-items-center justify-content-between border-bottom px-4 py-3">
          <h2 className="h6 fw-semibold mb-0">
            {isEdit ? `Edit ${ITEM_LABELS[type].label.toLowerCase()}` : `New ${ITEM_LABELS[type].label.toLowerCase()}`}
          </h2>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>

        <div className="p-4">
          <FormAlert error={state.error} rateLimit={state.rateLimit} />

          <fieldset className="mb-3">
            <legend className="form-label small fw-medium mb-1">Type</legend>
            <div className="btn-group w-100 item-type-picker" role="group">
              {TYPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`btn btn-sm ${type === option ? 'btn-primary' : 'btn-outline-secondary'}`}
                  aria-pressed={type === option}
                  onClick={() => setType(option)}
                >
                  <i className={`bi ${ITEM_LABELS[option].icon} me-1`} aria-hidden="true" />
                  {ITEM_LABELS[option].label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mb-3">
            <label htmlFor={`${prefix}-title`} className="form-label small fw-medium">
              Title
            </label>
            <input
              id={`${prefix}-title`}
              name="title"
              className="form-control"
              required
              maxLength={200}
              defaultValue={item?.title}
              placeholder={
                type === 'EXAM' ? 'Midterm exam' : type === 'PROJECT' ? 'Group project' : type === 'ASSIGNMENT' ? 'Problem set 3' : 'Read chapter 4'
              }
            />
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-sm-6">
              <label htmlFor={`${prefix}-subject`} className="form-label small fw-medium">
                Subject
              </label>
              <select
                id={`${prefix}-subject`}
                name="subjectId"
                className="form-select"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12 col-sm-6">
              <label htmlFor={`${prefix}-due`} className="form-label small fw-medium">
                {type === 'EXAM' ? 'Exam date' : 'Due date'}
              </label>
              <input
                id={`${prefix}-due`}
                name="dueDate"
                type="date"
                className="form-control"
                defaultValue={item?.dueDate ?? ''}
                required={type === 'EXAM'}
              />
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-sm-6">
              <label htmlFor={`${prefix}-effort`} className="form-label small fw-medium">
                Effort needed
              </label>
              <div className="input-group">
                <input
                  id={`${prefix}-effort`}
                  name="estimateHours"
                  type="number"
                  inputMode="decimal"
                  min={0.25}
                  max={200}
                  step={0.25}
                  className="form-control tnum"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder={String(Math.round((suggestion / 60) * 100) / 100)}
                  aria-describedby={`${prefix}-effort-help`}
                />
                <span className="input-group-text">hours</span>
              </div>
              <div id={`${prefix}-effort-help`} className="form-text">
                {hours ? (
                  <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => setHours('')}>
                    Use the suggestion ({formatEffort(suggestion)})
                  </button>
                ) : (
                  <>Blank uses a suggestion: {formatEffort(suggestion)}.</>
                )}
              </div>
            </div>

            <fieldset className="col-12 col-sm-6">
              <legend className="form-label small fw-medium mb-2">Priority</legend>
              <div className="btn-group w-100" role="group">
                {PRIORITIES.map((p) => (
                  // A fragment, not a wrapper: Bootstrap's group styles need the
                  // radio and its label as direct children of .btn-group.
                  <Fragment key={p.value}>
                    <input
                      type="radio"
                      className="btn-check"
                      name="priority"
                      id={`${prefix}-priority-${p.value}`}
                      value={p.value}
                      defaultChecked={(item?.priority ?? 2) === p.value}
                    />
                    <label className="btn btn-sm btn-outline-secondary" htmlFor={`${prefix}-priority-${p.value}`}>
                      {p.label}
                    </label>
                  </Fragment>
                ))}
              </div>
            </fieldset>
          </div>

          <div>
            <label htmlFor={`${prefix}-notes`} className="form-label small fw-medium">
              Notes
            </label>
            <textarea
              id={`${prefix}-notes`}
              name="notes"
              className="form-control"
              rows={2}
              maxLength={2000}
              defaultValue={item?.notes ?? ''}
            />
          </div>
        </div>

        <div className="d-flex justify-content-end gap-2 border-top px-4 py-3 bg-body-tertiary">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            Cancel
          </button>
          <Submit label={isEdit ? 'Save changes' : `Add ${ITEM_LABELS[type].label.toLowerCase()}`} blocked={limited} />
        </div>
      </form>
    </dialog>
  )
}
