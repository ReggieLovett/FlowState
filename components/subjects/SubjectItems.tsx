'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { createItemAction, deleteItemAction, setItemStatusAction } from '@/lib/actions/items'
import type { ActionState } from '@/lib/actions/schedule'
import { ITEM_LABELS, suggestEstimate, type ItemKind } from '@/lib/scheduling'
import { ActionForm } from '@/components/feedback/ActionForm'
import { FormAlert, useRateLimitActive } from '@/components/feedback/FormAlert'
import {
  ItemFormModal,
  formatEffort,
  type EditableItem,
  type ItemSubjectOption,
} from './ItemFormModal'

/** An item as the subjects page hands it to the client. */
export interface SubjectItemView extends EditableItem {
  status: 'TODO' | 'DONE'
  /** Minutes of non-cancelled calendar time linked to the item. */
  bookedMinutes: number
  completedMinutes: number
  /** Sessions still to come. */
  upcomingSessions: number
}

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * "Due in 3 days", "Exam tomorrow", "Overdue by 2 days".
 *
 * Due dates are date-only, so both sides are compared as calendar days in the
 * browser's timezone. `today` is passed in so the server and the first client
 * render agree.
 */
function dueText(item: SubjectItemView, todayISO: string): { text: string; tone: 'danger' | 'warning' | 'muted' } | null {
  if (!item.dueDate) return null
  const [y, m, d] = item.dueDate.split('-').map(Number)
  const [ty, tm, td] = todayISO.split('-').map(Number)
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000)
  const noun = item.type === 'EXAM' ? 'Exam' : 'Due'
  const date = DAY.format(new Date(y, m - 1, d))

  if (item.status === 'DONE') return { text: `${noun} ${date}`, tone: 'muted' }
  if (days < 0) return { text: `Overdue by ${-days} ${-days === 1 ? 'day' : 'days'}`, tone: 'danger' }
  if (days === 0) return { text: `${noun} today`, tone: 'danger' }
  if (days === 1) return { text: `${noun} tomorrow`, tone: 'warning' }
  if (days <= 7) return { text: `${noun} in ${days} days · ${date}`, tone: 'warning' }
  return { text: `${noun} ${date}`, tone: 'muted' }
}

function QuickAddButton({ blocked = false }: { blocked?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-sm btn-outline-primary flex-shrink-0" disabled={pending || blocked}>
      {pending ? (
        <span className="spinner-border spinner-border-sm" aria-hidden="true" />
      ) : (
        <i className="bi bi-plus-lg" aria-hidden="true" />
      )}
      <span className="visually-hidden">Add</span>
    </button>
  )
}

/**
 * The item list inside one subject card: tick, edit, delete, and a one-line
 * quick add that creates a task with suggested effort.
 */
export function SubjectItems({
  subject,
  subjects,
  items,
  todayISO,
  disabled = false,
}: {
  subject: ItemSubjectOption
  subjects: ItemSubjectOption[]
  items: SubjectItemView[]
  todayISO: string
  disabled?: boolean
}) {
  const open = items.filter((i) => i.status === 'TODO')
  const done = items.filter((i) => i.status === 'DONE')
  const [editing, setEditing] = useState<SubjectItemView | null>(null)
  const [creatingType, setCreatingType] = useState<ItemKind | null>(null)
  const [quickType, setQuickType] = useState<ItemKind>('TASK')
  const [quickState, quickAction] = useActionState(createItemAction, {} as ActionState)
  const quickForm = useRef<HTMLFormElement>(null)
  const quickLimited = useRateLimitActive(quickState.rateLimit)

  // Clear the one-liner after each successful add so the next can be typed.
  useEffect(() => {
    if (quickState.ok) quickForm.current?.reset()
  }, [quickState])

  // Blank estimates count at their suggestion, the same figure the planner uses.
  const effort = open.reduce((sum, i) => sum + (i.estimatedMinutes ?? suggestEstimate(i.type, subject.difficulty)), 0)

  return (
    <div className="subject-items">
      <div className="d-flex align-items-center justify-content-between gap-2 px-3 pt-2 pb-1">
        <span className="small fw-semibold">
          Work
          <span className="text-secondary fw-normal ms-2 tnum">
            {open.length} open{effort > 0 ? ` · ${formatEffort(effort)} estimated` : ''}
          </span>
        </span>
        {!disabled && (
          // A plain button rather than a Bootstrap dropdown: the app keeps its
          // controls independent of the Bootstrap bundle, and the dialog has
          // its own type picker.
          <button
            type="button"
            className="btn btn-sm btn-link text-decoration-none p-0"
            onClick={() => setCreatingType('TASK')}
          >
            <i className="bi bi-plus-circle me-1" aria-hidden="true" />
            Add<span className="d-none d-sm-inline"> with details</span>
          </button>
        )}
      </div>

      {open.length === 0 && done.length === 0 ? (
        <p className="text-secondary small px-3 mb-2">
          Nothing here yet. Add the exams, assignments and tasks for this subject and the
          planner will schedule time for them.
        </p>
      ) : (
        <ul className="list-unstyled mb-0 item-list">
          {open.map((item) => (
            <ItemRow key={item.id} item={item} todayISO={todayISO} onEdit={() => setEditing(item)} disabled={disabled} />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <details className="item-done px-3">
          <summary className="small text-secondary py-1">
            {done.length} completed
          </summary>
          <ul className="list-unstyled mb-1 item-list">
            {done.map((item) => (
              <ItemRow key={item.id} item={item} todayISO={todayISO} onEdit={() => setEditing(item)} disabled={disabled} />
            ))}
          </ul>
        </details>
      )}

      {!disabled && (
        <form ref={quickForm} action={quickAction} className="d-flex gap-1 px-3 pt-2 pb-3">
          <input type="hidden" name="subjectId" value={subject.id} />
          <input type="hidden" name="type" value={quickType} />
          <select
            className="form-select form-select-sm flex-shrink-0 item-quick-type"
            value={quickType}
            onChange={(e) => setQuickType(e.target.value as ItemKind)}
            aria-label="Type"
          >
            {(['TASK', 'ASSIGNMENT', 'PROJECT', 'EXAM'] as ItemKind[]).map((type) => (
              <option key={type} value={type}>
                {ITEM_LABELS[type].label}
              </option>
            ))}
          </select>
          <input
            name="title"
            className="form-control form-control-sm"
            placeholder={`Quick add to ${subject.name}`}
            aria-label={`New item title for ${subject.name}`}
            maxLength={200}
            required
          />
          {quickType === 'EXAM' && (
            <input
              name="dueDate"
              type="date"
              className="form-control form-control-sm flex-shrink-0"
              style={{ width: '9.5rem' }}
              aria-label="Exam date"
              required
            />
          )}
          <QuickAddButton blocked={quickLimited} />
        </form>
      )}
      <FormAlert error={quickState.error} rateLimit={quickState.rateLimit} className="mx-3 mt-n1 mb-3" />

      {editing && (
        <ItemFormModal open onClose={() => setEditing(null)} subjects={subjects} item={editing} />
      )}
      {creatingType && (
        <ItemFormModal
          open
          onClose={() => setCreatingType(null)}
          subjects={subjects}
          subjectId={subject.id}
          defaultType={creatingType}
        />
      )}
    </div>
  )
}

function ItemRow({
  item,
  todayISO,
  onEdit,
  disabled,
}: {
  item: SubjectItemView
  todayISO: string
  onEdit: () => void
  disabled: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const isDone = item.status === 'DONE'
  const due = dueText(item, todayISO)
  const effort = item.estimatedMinutes
  const booked = Math.min(item.bookedMinutes, effort ?? item.bookedMinutes)
  const share = effort ? Math.min(1, item.bookedMinutes / effort) : 0

  return (
    <li className={`item-row${isDone ? ' is-done' : ''}`}>
      <ActionForm action={setItemStatusAction} className="flex-shrink-0">
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="status" value={isDone ? 'TODO' : 'DONE'} />
        <button
          type="submit"
          className={`item-check${isDone ? ' is-done' : ''}`}
          aria-label={isDone ? `Mark ${item.title} not done` : `Mark ${item.title} done`}
          disabled={disabled}
        >
          {isDone && <i className="bi bi-check-lg" aria-hidden="true" />}
        </button>
      </ActionForm>

      <button type="button" className="item-main" onClick={onEdit} disabled={disabled}>
        <span className="d-flex align-items-center gap-2 min-width-0">
          <i className={`bi ${ITEM_LABELS[item.type].icon} text-secondary flex-shrink-0`} aria-hidden="true" />
          <span className="item-title text-truncate">{item.title}</span>
          {item.priority === 3 && !isDone && (
            <span className="badge rounded-pill text-bg-warning flex-shrink-0">High</span>
          )}
        </span>
        <span className="item-meta">
          <span className="chip">{ITEM_LABELS[item.type].label}</span>
          {due && (
            <span className={`item-due is-${due.tone}`} suppressHydrationWarning>
              {due.text}
            </span>
          )}
          <span className="tnum">
            {effort
              ? `${formatEffort(booked)} of ${formatEffort(effort)} booked`
              : item.bookedMinutes > 0
                ? `${formatEffort(item.bookedMinutes)} booked`
                : 'Effort suggested'}
          </span>
        </span>
        {effort ? (
          <span className="item-progress" aria-hidden="true">
            <span style={{ width: `${share * 100}%` }} />
          </span>
        ) : null}
      </button>

      {!disabled && (
        <div className="flex-shrink-0 d-flex align-items-center">
          {confirming ? (
            <ActionForm action={deleteItemAction} className="d-flex gap-1">
              <input type="hidden" name="id" value={item.id} />
              <button type="submit" className="btn btn-sm btn-danger py-0">
                Delete
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary py-0" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </ActionForm>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-link text-secondary item-delete"
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${item.title}`}
              title={item.upcomingSessions > 0 ? `Delete, and remove ${item.upcomingSessions} planned sessions` : 'Delete'}
            >
              <i className="bi bi-trash3" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </li>
  )
}
