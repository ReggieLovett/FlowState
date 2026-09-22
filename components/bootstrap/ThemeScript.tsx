/**
 * Applies the stored colour theme before first paint.
 *
 * Bootstrap 5.3 reads `data-bs-theme` off the root element. Setting it from an
 * effect would render the light palette first and then snap to dark, so this
 * runs synchronously in <head>. Kept to the few statements it needs.
 *
 * It is the only inline script the app writes itself, so it needs the request's
 * CSP nonce passed in explicitly. Next.js stamps the nonce onto the scripts it
 * generates, but not onto a raw <script> element; without it the browser would
 * refuse to run this and every page would flash light before turning dark.
 */
const SCRIPT = `(function(){try{var t=localStorage.getItem('cadence-theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-bs-theme',t==='dark'||t==='light'?t:(m?'dark':'light'))}catch(e){}})()`

export function ThemeScript({ nonce }: { nonce?: string }) {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCRIPT }} />
}
