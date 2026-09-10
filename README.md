# FlowState

A multi-user scheduling app for college students and working professionals. Plan
lectures, seminars, lab sessions, client meetings, project deadlines and deep
work shifts in one place.

Next.js 16 (App Router), Auth.js v5, Prisma 7 on PostgreSQL, Bootstrap 5.
Deploys to Vercel with no configuration beyond environment variables.

Every user's data is isolated. See [ARCHITECTURE.md](ARCHITECTURE.md) for how
that is enforced, and `npm run db:verify` for the proof.

---

## Quick start

1. **Provision a Postgres database.** Supabase, Neon or Vercel Postgres. You need
   two connection strings: a pooled one and a direct one. `.env.example` explains
   why.

2. **Configure.**

   ```bash
   cp .env.example .env
   ```

   Fill in `DATABASE_URL`, `DIRECT_URL`, and generate a secret:

   ```bash
   npx auth secret
   ```

3. **Install and migrate.**

   ```bash
   npm install && npm run db:migrate
   ```

4. **Run.**

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000>, create an account, and your dashboard arrives
   pre-populated with six starter templates you can rename or delete.

### Scripts

| Script               | What it does                                               |
| -------------------- | ---------------------------------------------------------- |
| `npm run dev`        | Development server                                         |
| `npm run build`      | Production build (runs `prisma generate` first)            |
| `npm start`          | Serve the production build                                 |
| `npm run lint`       | ESLint                                                     |
| `npm run typecheck`  | TypeScript, no emit                                        |
| `npm run db:migrate` | Create and apply a migration in development                |
| `npm run db:deploy`  | Apply pending migrations (use in deployment)               |
| `npm run db:studio`  | Browse the database                                        |
| `npm run db:verify`  | Prove the data-isolation guarantees. Scratch database only |

---

## What is in it

**Accounts.** Email and password, plus GitHub OAuth when you configure it. The
GitHub button only appears if `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` are set,
so a fresh install is not broken by a dead provider.

**Isolation.** Every query is scoped to the signed-in user by construction, not
by convention. No data function accepts a `userId` argument, and the schema puts
ownership inside the WHERE clause of every update and delete.

**Starter templates.** A new account is seeded with six subjects spanning both
audiences: a lecture, a seminar, a lab session, a client check-in, a project
milestone and a deep work block. They are ordinary rows the user owns, so
renaming, recolouring, archiving and deleting all work on them exactly as on
anything else. "Restore defaults" fills gaps without disturbing customised rows.

**Schedule.** A week view with day sections, create and edit dialogs, all-day
events for deadlines, and completion tracking.

**Theme.** Light and dark, following the system by default, remembered per
browser and applied before first paint so there is no flash. Every foreground and
background pair clears WCAG AA in both themes.

---

## Routes

| Path                  | Access    | Purpose                                  |
| --------------------- | --------- | ---------------------------------------- |
| `/`                   | Public    | Redirects to the dashboard or to sign-in |
| `/login`, `/register` | Public    | Authentication                           |
| `/dashboard`          | Protected | Today, this week, upcoming deadlines     |
| `/dashboard/schedule` | Protected | The week, with event CRUD                |
| `/dashboard/subjects` | Protected | Subject CRUD and restore defaults        |
| `/dashboard/settings` | Protected | Account and category reference           |
| `/api/schedule`       | Protected | Example JSON API, session-scoped         |
| `/api/register`       | Public    | Credentials sign-up                      |
| `/api/auth/*`         | Public    | Auth.js                                  |

---

## Deploying to Vercel

1. Push to Git and import the repository at [vercel.com/new](https://vercel.com/new).
2. Set the environment variables:

   | Variable                                | Value                                                                       |
   | --------------------------------------- | --------------------------------------------------------------------------- |
   | `DATABASE_URL`                          | Pooled connection. Supabase port 6543, `?pgbouncer=true&connection_limit=1` |
   | `DIRECT_URL`                            | Direct connection. Supabase port 5432                                       |
   | `AUTH_SECRET`                           | `npx auth secret`                                                           |
   | `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | Optional                                                                    |

3. Deploy, then apply migrations once: `npm run db:deploy`.
4. For GitHub OAuth, set the callback to
   `https://<your-domain>/api/auth/callback/github`.

`AUTH_URL` is inferred from the deployment and is not needed. The build itself
does not require a reachable database: the Prisma client is constructed lazily,
so a preview deployment without database variables still builds.

---

## Verifying isolation

```bash
npm run db:verify
```

Creates two users, seeds both, and asserts that neither can read, update or
delete the other's rows; that starter templates are per-user and fully mutable;
that restoring defaults does not resurrect a renamed template; and that deleting
a user cascades to their own data and nothing else.

Point it at a scratch database. It cleans up its own fixtures, but it is
destructive by nature.

---

## Previous implementations

Two earlier versions are preserved and excluded from the build and from
deployment:

- `legacy-vue/` - the original Vue 3 + Vite app, with its documentation and tests.
- `legacy-tailwind/` - a single-user, browser-storage version with a Tailwind UI
  and an automatic timetable generator.

Delete either once you are sure nothing else is needed from it.

**Note:** the automatic scheduling engine from `legacy-tailwind/` (which
allocated study time by exam proximity and difficulty) is **not** carried into
this version. This app is a manual scheduler. Porting that engine on top of the
`Subject` and `ScheduleEvent` models is a self-contained piece of work if you
want it back.
