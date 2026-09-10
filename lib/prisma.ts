import 'server-only'

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * Prisma client singleton.
 *
 * Three concerns are handled here.
 *
 * Connections. Prisma 7 takes its runtime connection from a driver adapter
 * rather than from the schema. The pooled DATABASE_URL is what belongs here: a
 * serverless function is frozen between invocations, so an unpooled connection
 * per instance will exhaust Postgres under any real traffic.
 *
 * Hot reload. `next dev` re-evaluates modules on every change. Without the
 * globalThis cache each reload would construct another client, each with its own
 * pool, until the database refuses connections. Production gets a fresh module
 * registry per instance, so the cache is only attached in development.
 *
 * Build time. The client is constructed lazily, on first property access, rather
 * than when this module is imported. `next build` imports every route while
 * collecting page data, so an eager `new PrismaClient()` makes DATABASE_URL a
 * *build-time* requirement: the build fails outright wherever it is absent, such
 * as a Vercel preview deployment whose environment variables are scoped to
 * production. Deferring construction keeps the database a runtime dependency,
 * where it belongs, while still failing loudly on the first real query.
 */

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    // Reached on the first query, not on import. Named explicitly so the cause
    // is obvious rather than surfacing as an opaque adapter error.
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env for local development, ' +
        'or add it to your Vercel project environment variables.',
    )
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    // Password hashes are write-only outside the credential verifier. Any
    // future user or admin query must explicitly opt in to read this field.
    omit: {
      user: {
        passwordHash: true,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

type PrismaClientSingleton = ReturnType<typeof createPrismaClient>

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined
}

function getPrismaClient(): PrismaClientSingleton {
  if (globalForPrisma.prisma) return globalForPrisma.prisma

  const client = createPrismaClient()

  // In production this caches on the instance for its lifetime, which is the
  // same lifetime the module registry would have had anyway.
  globalForPrisma.prisma = client
  return client
}

/**
 * Behaves exactly like a PrismaClient. The Proxy exists only to delay
 * construction until the first property access.
 *
 * Methods are bound to the real client: Prisma's own methods rely on `this`, and
 * an unbound `$transaction` pulled off the Proxy would otherwise be invoked with
 * the Proxy as its receiver.
 */
export const prisma = new Proxy({} as PrismaClientSingleton, {
  get(_target, property) {
    const client = getPrismaClient()
    const value = Reflect.get(client, property, client)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
