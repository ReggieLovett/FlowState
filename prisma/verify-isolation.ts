/**
 * Proof that the data-isolation requirement holds at the database level.
 *
 * Run against a scratch database:  npm run db:verify
 *
 * This exercises the exact Prisma calls lib/data/* makes, so it tests the schema
 * guarantee rather than the application's good intentions. If someone later
 * removes `@@unique([id, userId])` and "fixes" the resulting type error by
 * switching to `where: { id }`, these assertions fail.
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
})

let failures = 0

function check(name: string, passed: boolean, detail = '') {
  const mark = passed ? 'PASS' : 'FAIL'
  if (!passed) failures += 1
  console.log(`  [${mark}] ${name}${detail ? ` -> ${detail}` : ''}`)
}

async function main() {
  // Clean slate for the two fixtures.
  await prisma.user.deleteMany({
    where: { email: { in: ['alice@example.com', 'bob@example.com'] } },
  })

  const alice = await prisma.user.create({
    data: { email: 'alice@example.com', name: 'Alice Nwosu' },
  })
  const bob = await prisma.user.create({
    data: { email: 'bob@example.com', name: 'Bob Iyer' },
  })

  // Each user gets their own starter templates.
  const { seedDefaultSubjects } = await import('../lib/data/seed-templates')
  await seedDefaultSubjects(prisma, alice.id)
  await seedDefaultSubjects(prisma, bob.id)

  console.log('\nSeeding (requirement 4)')
  // Ordered, so the assertions below target known templates rather than
  // whichever row the database happened to return first.
  const aliceSubjects = await prisma.subject.findMany({
    where: { userId: alice.id },
    orderBy: { seedKey: 'asc' },
  })
  const bobSubjects = await prisma.subject.findMany({ where: { userId: bob.id } })

  const byKey = (key: string) => {
    const found = aliceSubjects.find((s) => s.seedKey === key)
    if (!found) throw new Error(`Fixture missing seedKey "${key}"`)
    return found
  }
  check('Alice received starter templates', aliceSubjects.length === 6, `${aliceSubjects.length} rows`)
  check('Bob received his own copies', bobSubjects.length === 6, `${bobSubjects.length} rows`)
  check(
    'Templates are per-user rows, not shared',
    aliceSubjects.every((a) => !bobSubjects.some((b) => b.id === a.id)),
  )
  check(
    'Templates are fully editable (seeding does not gate writes)',
    (await prisma.subject.update({
      where: { id_userId: { id: byKey('core-lecture').id, userId: alice.id } },
      data: { name: 'Distributed Systems', category: 'LECTURE' },
    })).name === 'Distributed Systems',
  )
  check(
    'Templates are deletable',
    (await prisma.subject.deleteMany({
      where: { id: byKey('discussion-seminar').id, userId: alice.id },
    })).count === 1,
  )

  // Re-seed is idempotent: restores only what is missing, never duplicates.
  const restored = await seedDefaultSubjects(prisma, alice.id)
  check(
    'Restore defaults re-creates only the deleted template',
    restored === 1,
    `${restored} row re-created`,
  )
  check(
    'Restore defaults does not resurrect a renamed template',
    (await prisma.subject.count({ where: { userId: alice.id, name: 'Core Module Lecture' } })) === 0,
  )
  check(
    'Renamed template kept its identity',
    (await prisma.subject.findFirst({ where: { userId: alice.id, seedKey: 'core-lecture' } }))
      ?.name === 'Distributed Systems',
  )

  const aliceEvent = await prisma.scheduleEvent.create({
    data: {
      userId: alice.id,
      subjectId: byKey('core-lecture').id,
      title: 'Consensus protocols',
      category: 'LECTURE',
      startsAt: new Date('2026-10-01T09:00:00Z'),
      endsAt: new Date('2026-10-01T10:30:00Z'),
    },
  })

  console.log('\nData isolation (requirement 2)')

  // READ
  check(
    'Bob cannot read Alice\'s event',
    (await prisma.scheduleEvent.findUnique({
      where: { id_userId: { id: aliceEvent.id, userId: bob.id } },
    })) === null,
  )
  check(
    'Alice can read her own event',
    (await prisma.scheduleEvent.findUnique({
      where: { id_userId: { id: aliceEvent.id, userId: alice.id } },
    }))?.id === aliceEvent.id,
  )
  check(
    'Bob\'s list query never contains Alice\'s rows',
    (await prisma.scheduleEvent.findMany({ where: { userId: bob.id } })).length === 0,
  )

  // UPDATE
  let updateBlocked = false
  try {
    await prisma.scheduleEvent.update({
      where: { id_userId: { id: aliceEvent.id, userId: bob.id } },
      data: { title: 'Hijacked' },
    })
  } catch {
    updateBlocked = true
  }
  check('Bob cannot update Alice\'s event', updateBlocked)

  // DELETE
  const bobDelete = await prisma.scheduleEvent.deleteMany({
    where: { id: aliceEvent.id, userId: bob.id },
  })
  check('Bob cannot delete Alice\'s event', bobDelete.count === 0, `${bobDelete.count} rows affected`)

  const survivor = await prisma.scheduleEvent.findUnique({ where: { id: aliceEvent.id } })
  check(
    'Alice\'s event survived intact',
    survivor?.title === 'Consensus protocols',
    survivor?.title,
  )

  // Cross-tenant foreign key: attaching Bob's event to Alice's subject is
  // rejected by the ownership pre-check in lib/data/schedule.ts. Confirm the
  // lookup that pre-check relies on returns nothing.
  check(
    'Bob cannot resolve Alice\'s subject to attach an event to it',
    (await prisma.subject.findUnique({
      where: { id_userId: { id: byKey('core-lecture').id, userId: bob.id } },
    })) === null,
  )

  console.log('\nCascade behaviour')
  await prisma.user.delete({ where: { id: alice.id } })
  check(
    'Deleting a user removes their events',
    (await prisma.scheduleEvent.count({ where: { userId: alice.id } })) === 0,
  )
  check(
    'Deleting a user leaves other users untouched',
    (await prisma.subject.count({ where: { userId: bob.id } })) === 6,
  )

  await prisma.user.deleteMany({ where: { email: 'bob@example.com' } })

  console.log(
    failures === 0
      ? '\nAll isolation checks passed.\n'
      : `\n${failures} check(s) FAILED.\n`,
  )
  process.exitCode = failures === 0 ? 0 : 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
