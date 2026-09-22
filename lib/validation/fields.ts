import { z } from 'zod'

/**
 * Field rules shared by every entry point: Server Actions, Route Handlers and the
 * Auth.js credentials check. Defined once so the form, the JSON API and the
 * sign-in endpoint cannot drift apart, which is how the password rule below came
 * to be enforced in one place and not another.
 *
 * None of this is what prevents SQL injection. Prisma sends every value as a
 * bound parameter, so a string reaches Postgres as data however it is shaped.
 * These rules exist to reject malformed input early, bound how much work a
 * request can cause, and keep Invalid Date values away from the database.
 */

/**
 * Row identifiers.
 *
 * Prisma's cuid() ids are 25 lowercase alphanumerics. The pattern is kept loose
 * (letters, digits, _ and -) so a future switch to cuid2 or uuid does not need a
 * change here, while still refusing anything that could not be an id: long
 * strings, whitespace, quotes, and the characters an injection payload needs.
 */
export const idSchema = z
  .string()
  .trim()
  .min(1, 'Missing id.')
  .max(64, 'Invalid id.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid id.')

/** Parses an id out of form data, returning null for anything malformed. */
export function formId(value: FormDataEntryValue | null): string | null {
  const parsed = idSchema.safeParse(value ?? '')
  return parsed.success ? parsed.data : null
}

/** RFC 5321 caps a forward path at 254 characters. */
export const emailSchema = z
  .email({ message: 'Enter a valid email address.' })
  .max(254, 'That email address is too long.')
  .transform((value) => value.trim().toLowerCase())

/**
 * bcrypt reads only the first 72 bytes of its input and silently ignores the
 * rest. With a 200-character cap, a long password was only partly checked: any
 * string sharing its first 72 bytes also signed in. The cap is in UTF-8 bytes,
 * not characters, because a character limit under-counts: 19 emoji are 76 bytes.
 */
export const BCRYPT_MAX_BYTES = 72
export const PASSWORD_MIN_CHARS = 12

// TextEncoder rather than Buffer, so this module stays importable from the Edge
// runtime and the browser as well as Node.
const utf8 = new TextEncoder()
export const utf8Length = (value: string) => utf8.encode(value).length

export const newPasswordSchema = z
  .string()
  // Length is the property that matters. Composition rules push people toward
  // predictable substitutions, so a floor is used instead.
  .min(PASSWORD_MIN_CHARS, `Use at least ${PASSWORD_MIN_CHARS} characters.`)
  .refine((value) => utf8Length(value) <= BCRYPT_MAX_BYTES, {
    message: `Use at most ${BCRYPT_MAX_BYTES} bytes. That is 72 plain letters, or fewer with accents or emoji.`,
  })

/**
 * A password offered at sign-in.
 *
 * Deliberately not capped at 72 bytes: an account created before that rule
 * existed may have a longer password, and bcrypt compares it the same way it was
 * hashed. The ceiling here only bounds the work one request can cause.
 */
export const signInPasswordSchema = z
  .string()
  .min(1, 'Enter your password.')
  .max(1024, 'That password is too long.')

/** A calendar date as sent by <input type="date">. */
export const dateInputSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date.')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), {
    message: 'Pick a valid date.',
  })

/** A wall-clock time as sent by <input type="time">, HH:MM in 24-hour form. */
export const timeInputSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a valid time.')
