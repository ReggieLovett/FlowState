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

  /**
   * SQL injection guard.
   *
   * Every query in the app is safe today because Prisma sends values as bound
   * parameters: the tagged-template form `$queryRaw\`... ${value}\`` turns each
   * `${}` into `$1`, `$2`, never into SQL text. Exactly three APIs defeat that by
   * accepting a string that becomes SQL verbatim. They are banned here so a
   * future change cannot reintroduce injection without the build failing.
   *
   * If raw SQL is genuinely needed, write it as a tagged template, or compose
   * with `Prisma.sql` and `Prisma.join`, all of which stay parameterised.
   */
  {
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: '$queryRawUnsafe',
          message:
            'Splices a string into SQL (injection risk). Use the tagged template prisma.$queryRaw`...${value}` so values are bound parameters.',
        },
        {
          property: '$executeRawUnsafe',
          message:
            'Splices a string into SQL (injection risk). Use the tagged template prisma.$executeRaw`...${value}` so values are bound parameters.',
        },
        {
          object: 'Prisma',
          property: 'raw',
          message:
            'Prisma.raw() inserts text into SQL unescaped (injection risk). Use Prisma.sql and Prisma.join, which keep values parameterised.',
        },
      ],
    },
  },
]

export default config
