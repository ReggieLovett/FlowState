// Prisma 7 no longer loads .env automatically, so the config file does it.
// Next.js still loads .env itself for the application at runtime; this import
// only covers the CLI (migrate, db push, studio, seed).
import 'dotenv/config'

import { defineConfig, env } from 'prisma/config'

/**
 * Prisma 7 configuration.
 *
 * In Prisma 7 the datasource block in schema.prisma no longer carries connection
 * URLs. Migration and introspection commands read them from here; the running
 * application gets its connection from the driver adapter in lib/prisma.ts.
 *
 * Note which URL goes where. Migrations use DIRECT_URL because they take
 * advisory locks and run DDL, neither of which survives a transaction pooler.
 * The application uses the pooled DATABASE_URL, because on Vercel each
 * serverless invocation would otherwise open its own Postgres connection.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',

  datasource: {
    url: env('DIRECT_URL'),
  },

  migrations: {
    // `npx prisma db seed` -> creates the shared catalogue of starter templates.
    seed: 'npx tsx prisma/seed.ts',
  },
})
