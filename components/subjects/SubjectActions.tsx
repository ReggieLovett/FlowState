'use client'

import { useCallback, useState } from 'react'
import type { SubjectDTO } from '@/lib/data/subjects'
import { SubjectFormModal } from './SubjectFormModal'

/** Edit button plus its dialog, for one subject row. */
export function EditSubjectButton({ subject }: { subject: SubjectDTO }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${subject.name}`}
        title="Edit"
      >
        <i className="bi bi-pencil" aria-hidden="true" />
      </button>

      {open && (
        <SubjectFormModal open={open} onClose={() => setOpen(false)} subject={subject} />
      )}
    </>
  )
}

export function NewSubjectButton({
  className = 'btn btn-primary btn-sm',
}: {
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <i className="bi bi-plus-lg me-1" aria-hidden="true" />
        New subject
      </button>

      {open && <SubjectFormModal open={open} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * Delete with a confirmation step.
 *
 * Deleting a subject detaches its events rather than removing them
 * (onDelete: SetNull), so the wording says exactly that.
 */
export function DeleteSubjectButton({
  subject,
  action,
}: {
  subject: SubjectDTO
  action: (formData: FormData) => void
}) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={() => setConfirming(true)}
        aria-label={`Delete ${subject.name}`}
        title="Delete"
      >
        <i className="bi bi-trash3" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className="d-flex align-items-center gap-1">
      <form action={action}>
        <input type="hidden" name="id" value={subject.id} />
        <button type="submit" className="btn btn-sm btn-danger">
          Delete
        </button>
      </form>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={() => setConfirming(false)}
      >
        Cancel
      </button>
    </div>
  )
}

/**
 * Fetch-based delete with full client-side error handling.
 *
 * Shows a confirmation step, calls DELETE /api/subjects/:id, and notifies the
 * parent via `onDeleted` on success so it can remove the card from the DOM.
 */
export function FetchDeleteSubjectButton({
  subject,
  onDeleted,
}: {
  subject: SubjectDTO
  onDeleted: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleDelete = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/subjects/${subject.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }

      onDeleted(subject.id)
    } catch (err) {
      if (err instanceof TypeError && err.message === 'Failed to fetch') {
        setError('Network error. Check your connection and try again.')
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      }
    } finally {
      setLoading(false)
    }
  }, [subject.id, onDeleted])

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn-sm btn-danger"
        onClick={() => setConfirming(true)}
        aria-label={`Delete ${subject.name}`}
        title="Delete"
      >
        <i className="bi bi-trash3" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className="d-flex flex-column align-items-end gap-1">
      {error && (
        <div className="text-danger small" role="alert">
          {error}
        </div>
      )}
      <div className="d-flex align-items-center gap-1">
        <button
          type="button"
          className="btn btn-sm btn-danger"
          onClick={handleDelete}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
              Deleting…
            </>
          ) : (
            'Confirm delete'
          )}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => {
            setConfirming(false)
            setError(null)
          }}
          disabled={loading}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
