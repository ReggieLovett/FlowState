/**
 * Content Security Policy.
 *
 * The main job of a CSP is to make an injected <script> inert: even if some
 * user-controlled string ever reached the page as markup, the browser would
 * refuse to run it. React already escapes everything it renders, so this is the
 * second line behind that, and the one that still holds if a future change
 * reaches for dangerouslySetInnerHTML.
 *
 * Scripts: a fresh nonce per request plus 'strict-dynamic'. Next.js reads the
 * nonce out of this header while rendering and stamps it onto its own framework
 * and page scripts, and 'strict-dynamic' extends trust to the chunks those load.
 * Anything without the nonce is refused, which is what an injected script is.
 *
 * Styles: 'unsafe-inline', deliberately. The UI sets many `style={{...}}`
 * attributes, and a nonce cannot authorise a style *attribute*, only a <style>
 * element. Inline CSS cannot execute code; the realistic abuse is exfiltrating
 * text through attribute selectors, which needs an injection point this app
 * does not have. Tightening this means moving those styles into classes first.
 *
 * Kept free of Node APIs so it runs on either proxy runtime.
 */

/** 128 bits from the platform CSPRNG, base64-encoded. */
export function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

export function contentSecurityPolicy(nonce: string, options: { https: boolean }): string {
  const isDev = process.env.NODE_ENV === 'development'

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // React uses eval in development only, to rebuild server error stacks.
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    // data: covers the inline SVG used by the form switch in app/theme.css.
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    // Hot reload talks to the dev server over a WebSocket.
    'connect-src': ["'self'", ...(isDev ? ['ws:'] : [])],
    'object-src': ["'none'"],
    // Stops an injected <base href> from redirecting every relative URL.
    'base-uri': ["'self'"],
    // Forms may only post back here. GitHub is listed because Chrome applies
    // form-action to the redirect that follows a submission, and "Continue with
    // GitHub" is a form whose response redirects to github.com.
    'form-action': ["'self'", 'https://github.com'],
    // The app is never meant to be framed. Replaces X-Frame-Options, which is
    // still sent from next.config.js for browsers that predate this.
    'frame-ancestors': ["'none'"],
  }

  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`)

  // Keyed on the request's scheme, not on production mode. Served over plain
  // http (`npm run build && npm start` on localhost) it would rewrite every
  // script and stylesheet URL to https and the page would load nothing.
  if (options.https) policy.push('upgrade-insecure-requests')

  return policy.join('; ')
}
