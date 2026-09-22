import 'server-only'

import { NextResponse } from 'next/server'

/**
 * CSRF defences for Route Handlers.
 *
 * Server Actions already get this from Next.js: they are POST-only and compare
 * the Origin header against the Host before running. Route Handlers get nothing,
 * so a cookie-authenticated POST or DELETE here was protected only by the
 * session cookie's SameSite=Lax attribute. That stops the common attack, but it
 * is one browser setting away from not doing so, and it does not cover
 * same-site requests from another subdomain. These checks are the second line.
 */

/** The host this request was addressed to, as Next.js itself determines it. */
function requestHost(request: Request): string | null {
  // Vercel and most proxies set X-Forwarded-Host. A cross-origin page cannot set
  // it on a victim's request, because it is not a CORS-safelisted header and
  // this app answers no preflight, so it is safe to trust for this purpose.
  return request.headers.get('x-forwarded-host') ?? request.headers.get('host')
}

/**
 * Refuses a state-changing request that a browser sent from another origin.
 *
 * Browsers attach `Origin` to every cross-origin POST, PUT, PATCH and DELETE,
 * and to same-origin ones in all current engines. When it is missing, the
 * Fetch Metadata header `Sec-Fetch-Site` is consulted instead. When both are
 * missing the caller is not a browser (curl, a mobile client, a server): such a
 * caller holds no ambient cookies it did not choose to send, so CSRF does not
 * apply and the request is allowed.
 *
 * Returns a 403 response to send, or null to continue.
 */
export function rejectCrossOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get('origin')
  const host = requestHost(request)

  if (origin) {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      // "null" (a sandboxed iframe, a file: page) and anything unparseable.
      return forbidden()
    }
    return host && originHost === host ? null : forbidden()
  }

  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return forbidden()

  return null
}

/**
 * Requires a JSON body.
 *
 * `request.json()` parses whatever it is given regardless of Content-Type, so
 * without this a cross-site `<form enctype="text/plain">` could deliver a body
 * that happens to be valid JSON. A form cannot send `application/json` at all,
 * and a script can only do so after a CORS preflight that this app never
 * approves, so insisting on it closes that route by construction.
 */
export function rejectNonJson(request: Request): NextResponse | null {
  const type = request.headers.get('content-type') ?? ''
  const mediaType = type.split(';')[0]?.trim().toLowerCase()
  if (mediaType === 'application/json') return null

  return NextResponse.json(
    { error: 'Send the body as application/json.' },
    { status: 415 },
  )
}

function forbidden() {
  return NextResponse.json({ error: 'Cross-origin request refused.' }, { status: 403 })
}
