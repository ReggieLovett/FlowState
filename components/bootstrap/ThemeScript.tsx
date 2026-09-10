/**
 * Applies the stored colour theme before first paint.
 *
 * Bootstrap 5.3 reads `data-bs-theme` off the root element. Setting it from an
 * effect would render the light palette first and then snap to dark, so this
 * runs synchronously in <head>. Kept to the few statements it needs.
 */
const SCRIPT = `(function(){try{var t=localStorage.getItem('cadence-theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-bs-theme',t==='dark'||t==='light'?t:(m?'dark':'light'))}catch(e){}})()`

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
}
