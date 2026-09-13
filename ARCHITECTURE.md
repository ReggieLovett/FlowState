# Scheduling app: architecture

A multi-tenant scheduling application for college students and working
professionals. Next.js App Router, Auth.js v5, Prisma 7 against PostgreSQL,
Bootstrap 5, deployed on Vercel.

The organising constraint is requirement 2: a user must never be able to reach
another user's rows. Everything below is arranged so that isolation is a
property of the schema and of one guard function, rather than a rule each new
query has to remember.

---

## 1. The isolation model

Three layers, each independently sufficient for the common case and jointly
sufficient for the awkward ones.

```
Request
  |
  v
proxy.ts .................. Edge. Reads the session cookie, redirects
  |                         anonymous visitors away from /dashboard.
  |                         Convenience, NOT the security boundary.
  v
lib/auth-guard.ts ......... Node. requireUserId() turns the session into a
  |                         trusted id, or redirects. The ONLY place the
  |                         application reads session.user.id.
  v
lib/data/*.ts ............. Node, 'server-only'. Every query is scoped by that
  |                         id. No function takes a userId parameter, so no
  |                         caller can ask for someone else's data.
  v
prisma/schema.prisma ...... @@unique([id, userId]) puts ownership inside the
                            WHERE clause of every update and delete.
```

**Why the schema layer matters.** Prisma's `update` and `delete` require a
unique selector. Given only `id`, ownership cannot go in the same statement, so
the usual pattern is a `findUnique` to check the owner followed by an `update`.
That is two round trips, it is racy, and it is one forgotten `if` away from a
vulnerability. Declaring `@@unique([id, userId])` produces a compound selector:

```ts
// Cannot touch a row belonging to anyone else. Matches nothing and throws.
prisma.scheduleEvent.update({
  where: { id_userId: { id: eventId, userId } },
  data: patch,
});
```

For deletes, `deleteMany({ where: { id, userId } })` returns a count instead of
throwing, which lets "not yours" and "already gone" collapse into the same
harmless 404.

**Why no `userId` parameters.** `lib/data/schedule.ts` exposes
`listEventsInRange(from, to)`, not `listEventsInRange(userId, from, to)`. A
route handler physically cannot pass the wrong id, because there is no
parameter for one. This is the single highest-leverage decision in the design:
it converts "remember to filter" into "cannot express the unfiltered query".

**Why `import 'server-only'`.** Makes it a build error to import the data layer
into a client component, so Prisma and the database URL can never be bundled for
the browser.

---

## 2. Build order

1. **Provision Postgres.** Supabase, Neon, or Vercel Postgres. Copy both
   connection strings: the pooled one and the direct one. See `.env.example`
   for why there are two.
2. **Schema and migration.** `prisma/schema.prisma`, then `npm run db:migrate`.
3. **Auth.** `auth.config.ts` (edge-safe), `auth.ts` (full), the route handler,
   `proxy.ts`, and the session type augmentation in `types/next-auth.d.ts`.
4. **Seeding.** `lib/data/seed-templates.ts`, called from the `createUser` event
   for OAuth and from `app/api/register` for credentials.
5. **Data layer.** `lib/auth-guard.ts`, then `lib/data/schedule.ts` and
   `lib/data/subjects.ts`. Nothing outside this directory touches `prisma`.
6. **Verify isolation.** `npm run db:verify` against a scratch database.
7. **UI.** Bootstrap layout, then screens that call the data layer directly from
   Server Components and mutate through Server Actions in `lib/actions/`.

---

## 3. Files

```
prisma/
  schema.prisma            Models. User 1-M Subject, User 1-M ScheduleEvent,
                           Subject 1-M ScheduleEvent.
  migrations/              Committed. Applied on deploy with migrate deploy.
  verify-isolation.ts      Executable proof of requirements 2 and 4.
prisma.config.ts           Prisma 7 config: migration URL, seed command.

auth.config.ts             Edge-safe: providers + callbacks, no adapter.
auth.ts                    Full config: Prisma adapter, Credentials, seeding.
proxy.ts                   Route protection (Next 16's middleware convention).
types/next-auth.d.ts       Adds `id` to Session and JWT.

lib/
  prisma.ts                Client singleton with the pg driver adapter.
  auth-guard.ts            requireUserId() / getUserId().
  categories.ts            Display metadata for the commitment types.
  scheduling.ts            Smart scheduling engine. Pure; runs in the browser
                           for a live preview, no storage access.
  data/
    schedule.ts            Event CRUD, all user-scoped.
    subjects.ts            Subject CRUD, all user-scoped.
    seed-templates.ts      Starter templates. Pure; takes a client argument.

  actions/
    auth.ts                Sign in, register, sign out.
    schedule.ts            Event create/update/delete/status.
    scheduling.ts          Confirm, replace or clear a generated plan.
    subjects.ts            Subject CRUD, archive, restore defaults.

app/
  page.tsx                 Routes to the dashboard or to sign-in.
  login/  register/        Public auth screens.
  dashboard/               Protected. layout.tsx re-checks the session.
    page.tsx               Today, this week, upcoming deadlines.
    schedule/              Week view with event CRUD.
    subjects/              Subject CRUD and restore defaults.
    settings/              Account and category reference.
  api/
    auth/[...nextauth]/    Auth.js handlers.
    register/              Credentials sign-up.
    schedule/              Example secure route handler.

components/
  auth/  dashboard/  schedule/  subjects/  bootstrap/
```

Mutations go through Server Actions rather than the API route. They run on the
server, are scoped by the same `requireUserId()`, and work without JavaScript,
so the completion and delete controls are plain forms. `/api/schedule` remains as
the worked example of a secure route handler for clients that need HTTP.

---

## 4. Terminology

The `Category` enum is the vocabulary, chosen for students and professionals
rather than school timetables:

`LECTURE`, `SEMINAR`, `LAB_SESSION`, `CLIENT_MEETING`, `PROJECT_DEADLINE`,
`DEEP_WORK_SHIFT`, `OTHER`.

Labels and colours live in `lib/categories.ts`. The enum is the source of truth;
adding a category is a migration plus one entry in that map.

---

## 5. Pre-made templates (requirement 4)

Starter templates are **ordinary rows in `Subject`, owned by the user**, not a
shared catalogue joined at read time. Nothing in the data layer branches on
whether a row was seeded, so edit, archive and delete work on them through
exactly the same code paths as rows the user creates. That is what makes "full
CRUD access to the pre-made templates" true by construction rather than by
special case.

Two sign-up paths, both ending in a populated dashboard:

- **OAuth** goes through the Prisma adapter, so seeding hangs off the
  `createUser` event in `auth.ts`.
- **Credentials** does not touch the adapter, so `app/api/register` creates the
  user and seeds in one transaction. An account never exists without its
  templates.

`Subject.seedKey` holds a stable identity such as `core-lecture`, unique per
user. This exists because of a bug the verification script caught: keying on
name meant that renaming _Core Module Lecture_ to _Distributed Systems_ and then
pressing "restore defaults" re-created the original alongside the rename. A key
survives renaming, so restore only ever fills genuine gaps.

---

## 6. Vercel deployment

1. Push to Git and import the repository at vercel.com/new.
2. Environment variables:

   | Variable                                | Value                                                                       |
   | --------------------------------------- | --------------------------------------------------------------------------- |
   | `DATABASE_URL`                          | Pooled connection. Supabase port 6543, `?pgbouncer=true&connection_limit=1` |
   | `DIRECT_URL`                            | Direct connection. Supabase port 5432                                       |
   | `AUTH_SECRET`                           | `npx auth secret`                                                           |
   | `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | OAuth app credentials                                                       |

3. `AUTH_URL` is inferred from the deployment and is not needed.
4. Set the OAuth callback to `https://<your-domain>/api/auth/callback/github`.
5. Run migrations against production once per release:
   `npm run db:deploy`. Wire it into the build command if you want it automatic,
   but be aware every preview deployment would then migrate the same database.

Three details that bite on Vercel specifically:

- **`postinstall: prisma generate`.** Vercel caches `node_modules` between
  builds. Without this, a schema change ships against a stale client.
- **Pooling.** Each serverless invocation opens its own connection. An unpooled
  `DATABASE_URL` exhausts Postgres under modest traffic.
- **Migrations need the direct URL.** They take advisory locks and run DDL,
  neither of which survives a transaction pooler.

---

## 7. Notes on the stack

**Auth.js v5 is still a beta** (`5.0.0-beta.32`). It is the right choice for the
App Router: `auth()` works in Server Components, route handlers and `proxy.ts`
without ceremony, which v4 cannot do cleanly. But it is pre-1.0 and the API has
moved during the beta. If you need a stable dependency more than you need
ergonomics, `next-auth@4.24` works with the App Router at the cost of a clumsier
session API. Everything in `lib/data` is unaffected either way, because it only
consumes `requireUserId()`.

**Session strategy is JWT, not database.** Not a preference: the Credentials
provider cannot issue database sessions, so mixing Credentials with an adapter
requires JWT. The adapter still persists users, OAuth accounts and verification
tokens; only the session itself lives in a cookie.

**Prisma is pinned to 7.10.0 for both the CLI and the client.** At the time of
writing `prisma@latest` resolves to an 8.0 release candidate while
`@prisma/client@latest` is 7.10, so installing both with `@latest` silently
mismatches majors. Prisma 7 also moved connection URLs out of the schema into
`prisma.config.ts` and requires a driver adapter, which is why `lib/prisma.ts`
constructs `PrismaPg`.

**Next.js 16 renamed `middleware.ts` to `proxy.ts`** and requires a real function
export; the `export const { auth } = NextAuth(...)` form that worked in 15 is not
recognised.

---

## 8. Bootstrap 5

Bootstrap's CSS is imported in `app/layout.tsx`, followed by `app/theme.css`,
which overrides Bootstrap's CSS custom properties rather than restyling
components. Utilities, dark mode and future Bootstrap updates keep working.

```
app/layout.tsx
  bootstrap/dist/css/bootstrap.min.css
  bootstrap-icons/font/bootstrap-icons.css
  app/theme.css            <- token overrides + a handful of app classes
```

`components/bootstrap/BootstrapClient.tsx` loads the JS bundle from an effect.
It has to be deferred: the bundle touches `document` on import to register
dropdowns and tooltips, so importing it at module scope in a Server Component
crashes the render.

Two deliberate departures from stock Bootstrap:

- **Dialogs are native `<dialog>`, not Bootstrap Modal.** `showModal()` gives
  focus trapping, Escape-to-close and the backdrop for free, and does not depend
  on the Bootstrap bundle having finished loading before a user can click.
- **Mobile navigation is local state, not Offcanvas**, for the same reason, and
  so it closes reliably on navigation.

Two Bootstrap defaults needed correcting, both recorded in `app/theme.css`:
`.text-bg-light` is a fixed light chip that stays white in dark mode (replaced by
a themed `.chip`), and `.text-bg-primary` hard-codes white text, which fails
against the bright mint used as the dark-mode primary.

Bootstrap has no `min-width` utility, so `.min-width-0` is defined for flex
children whose text needs to truncate.

## 9. Verification

`npm run db:verify` runs `prisma/verify-isolation.ts` against the database in
`DIRECT_URL`. It creates two users, seeds both, and asserts that neither can
read, update or delete the other's rows, that starter templates are per-user and
fully mutable, and that deleting a user cascades to their data without touching
anyone else's.

Point it at a scratch database. It deletes its own fixtures, but it is a
destructive script by nature.
