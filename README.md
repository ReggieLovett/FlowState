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

**Schedule.** Week and day calendars on an hour-by-hour grid, plus the original
day-by-day list. Drag a block to move it, drag its bottom edge to resize, click
empty time to add an event, and tick blocks off in place. Alt and the arrow keys
move a focused block; add Shift to resize. Create and edit dialogs, all-day
events for deadlines, and completion tracking work in every view.

**Progress.** The overview shows the current streak, this week's completion rate,
study time against last week, total XP, a completed-against-planned chart for the
week, an 18-week streak calendar, hours per subject over 30 days, and exams and
deadlines due in the next two weeks.

**Rewards.** A 16-bit, Stardew Valley-inspired layer from the original spec. A
completed block earns 10 XP per 25 minutes once it has started. Finishing every
timed event in a day adds 50 XP, and consecutive days multiply block XP up to
1.5x, with 100 XP on every seventh day in a row. XP unlocks five pixel-art avatars
(Novice, Student, Scholar, Master, Prodigy), four seasonal backgrounds, and badges.
XP is derived from completed events rather than stored, so un-ticking a block
takes its XP back. The equipped avatar and season are kept in a cookie and
re-checked against earned XP on every request.

**Subject items.** Each subject is a container for its own tasks, assignments,
projects and exams, each with a due date, an effort estimate and a priority.
Effort can be left blank; the app suggests one from the item type and the
subject's difficulty. Items can be added in one line from the subject card, and
each shows how much of its effort is already booked on the calendar.

**Smart scheduling.** "Generate" on the schedule page builds a plan for the next
one, two or four weeks. Items are planned first, earliest deadline first: each
one's remaining effort is split into sessions and spread across the days before
it is due. Exam revision is spaced evenly up to the day before, assignments and
projects are front-loaded to leave a buffer, and a day may go past the daily
goal only when a deadline needs it. The rest of each daily goal is then filled
with general study time: subjects are ranked by exam proximity, difficulty,
urgency and time already booked, and focus blocks are placed in real gaps around
existing commitments.

A review step shows the plan as a timeline before it is saved. Blocks can be
dragged to another time or day, resized from their right edge, nudged with the
arrow keys, or removed and restored, and clashes, missed deadlines and blocks in
the past are flagged as they happen. Once saved, blocks stay draggable on the
week and day calendar, and item deadlines are drawn in its all-day row. No subject is studied after its exam, blocks can alternate
between subjects or stack into longer sessions, and a per-subject daily limit
stops one subject taking over a day. The preview shows the split, the reasons
behind each subject's rank and every block day by day before anything is saved.
Generated blocks are stamped with `generatedAt`, so a plan can be replaced or
cleared without touching events entered by hand. Preferences are remembered per
browser.

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
| `/dashboard/schedule` | Protected | Week, day and list views, smart planner  |
| `/dashboard/subjects` | Protected | Subject CRUD and restore defaults        |
| `/dashboard/rewards`  | Protected | Avatars, seasons, badges, XP breakdown   |
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

The automatic scheduling engine from `legacy-tailwind/` now lives in
`lib/scheduling.ts`, ported onto the `Subject` and `ScheduleEvent` models. Its
scoring weights are unchanged. The exam-proximity curve was corrected so that
it only falls as an exam moves further away; previously a subject with no exam
outranked one with an exam three weeks out.
