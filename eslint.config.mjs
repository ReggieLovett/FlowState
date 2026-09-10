import next from 'eslint-config-next'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

/**
 * Flat config. eslint-config-next 16 ships native flat exports, so no
 * FlatCompat bridge is needed.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      // Archived earlier implementations, kept for reference only.
      'legacy-vue/**',
      'legacy-tailwind/**',
    ],
  },
  ...next,
  ...nextCoreWebVitals,
  ...nextTypeScript,
]

export default config
