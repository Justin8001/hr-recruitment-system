import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

/** Lower-cased, trimmed email — '' becomes null so it never matches the dedup index. */
export function normalizeEmail(email?: string | null): string | null {
  const e = (email ?? '').trim().toLowerCase();
  return e || null;
}

/** Keep only digits (and a leading +) so formatting differences don't defeat dedup. */
export function normalizePhone(phone?: string | null): string | null {
  const raw = (phone ?? '').trim();
  if (!raw) return null;
  const plus = raw.startsWith('+') ? '+' : '';
  const digits = raw.replace(/\D/g, '');
  return digits ? plus + digits : null;
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
  if (email) {
    const r = await db.query('SELECT * FROM people WHERE lower(email) = $1 LIMIT 1', [email]);
    if (r.rows[0]) return r.rows[0];
  }
  if (phone) {
    const r = await db.query('SELECT * FROM people WHERE phone = $1 LIMIT 1', [phone]);
    if (r.rows[0]) return r.rows[0];
  }
  return undefined;
}

/**
 * Returns an existing person (matched by email or phone) or creates a new one.
 * Backfills a missing email/phone/referral on an existing person opportunistically.
 */
export async function findOrCreatePerson(db: Db, input: PersonInput): Promise<any> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);

  const existing = await findPerson(db, email, phone);
  if (existing) {
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
      return r.rows[0];
    } catch (err: any) {
      // Matched by phone but the email belongs to a different person — keep
      // the match and just skip the email backfill.
      if (err?.code !== '23505') throw err;
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
