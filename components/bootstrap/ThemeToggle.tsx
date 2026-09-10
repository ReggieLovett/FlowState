'use client'

import { useSyncExternalStore } from 'react'

/**
 * Light/dark switch.
 *
 * The stored value is browser state: reading it during render would not match
 * what the server produced, and reading it in an effect means a setState on
 * mount. `useSyncExternalStore` renders the server snapshot first and swaps in
 * the real value at hydration.
 */

const STORAGE_KEY = 'cadence-theme'
const listeners = new Set<() => void>()

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

function getSnapshot(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-bs-theme') === 'dark'
    ? 'dark'
    : 'light'
}

const getServerSnapshot = () => 'light' as const

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-bs-theme', next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private mode or blocked site data: apply for this session only.
    }
    listeners.forEach((listener) => listener())
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-sm btn-outline-secondary border-0"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      <i className={`bi bi-${theme === 'dark' ? 'sun' : 'moon-stars'}`} aria-hidden="true" />
    </button>
  )
}
