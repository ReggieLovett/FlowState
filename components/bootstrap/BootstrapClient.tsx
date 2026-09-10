'use client'

import { useEffect } from 'react'

/**
 * Loads Bootstrap's JavaScript bundle.
 *
 * Bootstrap's CSS is imported statically in the root layout, but its JS touches
 * `document` on import to register dropdowns, modals, offcanvas and tooltips.
 * Importing it at module scope in a Server Component crashes the render, so it
 * is pulled in from an effect, after hydration, in a client component.
 *
 * Renders nothing. Mount once, in the root layout.
 */
export function BootstrapClient() {
  useEffect(() => {
    // Dynamic import keeps the ~80KB bundle out of the initial payload.
    void import('bootstrap/dist/js/bootstrap.bundle.min.js')
  }, [])

  return null
}
