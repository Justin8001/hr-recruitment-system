import { HttpError } from './errors.js';
import type { PoolClient } from 'pg';

type Db = PoolClient;

/** Lower-cased, trimmed email — '' becomes null so it never matches the dedup index. */
export function normalizeEmail(email?: string | null): string | null {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return e || null;
}

/** Canonical digits; +972 and 00972 use the same form as an Israeli local number. */
export function normalizePhone(phone?: string | null): string | null {
  const raw = typeof phone === 'string' || typeof phone === 'number' ? String(phone).trim() : '';
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00972')) digits = '0' + digits.slice(5);
  else if (digits.startsWith('972')) digits = '0' + digits.slice(3);
  return digits || null;
}

export interface PersonInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  referral?: string | null;
}

/** A person already matching the given email or phone, if any. */
export async function findPerson(
  db: Db,
  email: string | null,
  phone: string | null
): Promise<any | undefined> {
  const r = await db.query(
    'SELECT * FROM people WHERE ($1::text IS NOT NULL AND lower(email) = $1) OR ($2::text IS NOT NULL AND phone = $2) ORDER BY id',
    [email, phone]);
  if (r.rows.length > 1) throw new HttpError(409, 'AMBIGUOUS_PERSON', 'פרטי הקשר תואמים למספר אנשים. יש לאחד כפילויות לפני השמירה.');
  return r.rows[0];
}

/**
 * Returns an existing person (matched by email or phone) or creates a new one.
 * Backfills a missing email/phone/referral on an existing person opportunistically.
 */
export async function findOrCreatePerson(db: Db, input: PersonInput): Promise<any> {
  await lockPeople(db);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);

  const existing = await findPerson(db, email, phone);
  if (existing) {
    await db.query('SAVEPOINT person_backfill');
    try {
      const r = await db.query(
        `UPDATE people
           SET email     = COALESCE(NULLIF(email, ''), $2),
               phone     = COALESCE(NULLIF(phone, ''), $3),
               referral  = COALESCE(NULLIF(referral, ''), $4)
         WHERE id = $1
         RETURNING *`,
        [existing.id, email, phone, input.referral ?? null]
      );
      await db.query('RELEASE SAVEPOINT person_backfill');
      return r.rows[0];
    } catch (err: any) {
      // Matched by phone but the email belongs to a different person — keep
      // the match and just skip the email backfill.
      if (err?.code !== '23505') throw err;
      await db.query('ROLLBACK TO SAVEPOINT person_backfill');
      const r = await db.query(
        `UPDATE people
           SET phone     = COALESCE(NULLIF(phone, ''), $2),
               referral  = COALESCE(NULLIF(referral, ''), $3)
         WHERE id = $1
         RETURNING *`,
        [existing.id, phone, input.referral ?? null]
      );
      return r.rows[0];
    }
  }

  const r = await db.query(
    `INSERT INTO people (name, email, phone, referral)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.name.trim(), email, phone, input.referral ?? null]
  );
  return r.rows[0];
}

// All creation/contact edits/imports/merges use this transaction-scoped lock.
// This also protects phone matching without silently merging legacy duplicates.
export async function lockPeople(db: PoolClient) {
  await db.query("SELECT pg_advisory_xact_lock(726451, 1)");
}
export function preferredName(names: string[]): string {
  const clean = names.filter(n => typeof n === 'string').map(n => n.trim()).filter(Boolean);
  return clean.find(n => /[\u0590-\u05ff]/.test(n)) || clean[0] || '';
}
