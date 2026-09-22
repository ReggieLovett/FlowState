/** @type {import('next').NextConfig} */

const isProd = process.env.NODE_ENV === 'production'

/**
 * Headers sent with every response.
 *
 * The Content-Security-Policy is not here: it carries a per-request nonce, so it
 * is set in proxy.ts. Everything that is the same on every response lives here.
 */
const securityHeaders = [
  // Stops the browser from guessing a type other than the one declared, which
  // is how an uploaded or reflected text file becomes executable HTML.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Other sites learn the origin a visitor came from, never the full URL, which
  // on this app can carry a week offset or a plan id.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Clickjacking. CSP `frame-ancestors 'none'` is the modern control; this is
  // for browsers that predate it. DENY rather than SAMEORIGIN: nothing here is
  // ever framed, even by the app itself.
  { key: 'X-Frame-Options', value: 'DENY' },
  // A page that opens this one in a popup cannot keep a handle to it, which
  // closes cross-window attacks such as tabnabbing. Safe with GitHub sign-in,
  // which is a full-page redirect rather than a popup.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Denies powerful browser features the app never uses, so injected code, or
  // an embedded third party added later, cannot ask for them either.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
  // Production only: HTTPS for two years, for this host and its subdomains.
  // `preload` is intentionally absent. Submitting a domain to the browser
  // preload list is a manual, slow-to-reverse commitment to make on purpose,
  // not a side effect of a config file.
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
]

const nextConfig = {
  reactStrictMode: true,

  // No `X-Powered-By: Next.js`. It tells an attacker which framework advisories
  // to try first and serves no purpose for a visitor.
  poweredByHeader: false,

  // Tree-shake icon imports so a single glyph does not pull the whole set.
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react', 'motion'],
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

module.exports = nextConfig
