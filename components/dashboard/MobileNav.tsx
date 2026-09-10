'use client'

import { useState } from 'react'
import { SidebarNav } from './SidebarNav'

/**
 * Sidebar navigation on small screens.
 *
 * Uses local state and a plain overlay rather than Bootstrap's Offcanvas JS, so
 * the panel does not depend on the Bootstrap bundle having loaded and closes
 * reliably on navigation.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary border-0 d-lg-none"
        aria-expanded={open}
        aria-label="Open navigation"
        onClick={() => setOpen(true)}
      >
        <i className="bi bi-list fs-5" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div
            className="position-fixed top-0 start-0 w-100 h-100 bg-dark bg-opacity-50"
            style={{ zIndex: 1040 }}
            onClick={() => setOpen(false)}
          />
          <div
            className="position-fixed top-0 start-0 h-100 app-sidebar p-3"
            style={{ zIndex: 1045, width: '16rem' }}
            role="dialog"
            aria-label="Navigation"
          >
            <div className="d-flex justify-content-between align-items-center mb-4">
              <span className="fw-semibold">Cadence</span>
              <button
                type="button"
                className="btn-close"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
              />
            </div>
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </>
      )}
    </>
  )
}
