'use client'

import { useEffect, useRef, useState } from 'react'
import { SidebarNav } from './SidebarNav'

/**
 * Sidebar navigation on small screens.
 *
 * A native dialog keeps the existing drawer appearance while providing focus
 * trapping, Escape dismissal and an inert background without Bootstrap JS.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 992px)')
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary border-0 d-lg-none"
        aria-expanded={open}
        aria-label="Open navigation"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <i className="bi bi-list fs-5" aria-hidden="true" />
      </button>

      <dialog
        ref={dialogRef}
        className="mobile-navigation app-sidebar p-3"
        aria-label="Navigation"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        onClick={event => {
          if (event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setOpen(false)
        }}
      >
        <div className="d-flex justify-content-between align-items-center mb-4">
          <span className="fw-semibold">FlowState</span>
          <button
            type="button"
            className="btn-close"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            autoFocus
          />
        </div>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </dialog>
    </>
  )
}
