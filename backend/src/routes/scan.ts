import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getProvider, sourceFor } from '../providers/index.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { findOrCreatePerson } from '../lib/people.js';
import type { ScanSettings } from '../providers/types.js';

const router = Router();

router.use(requireAuth);

async function getScanSettings(): Promise<ScanSettings> {
  const r = await pool.query('SELECT data FROM app_settings WHERE id = 1');
  const d = r.rows[0]?.data ?? {};
  return {
    query: d.query || 'קורות חיים, resume, CV, מועמדות',
    days: d.days || 60,
    attachOnly: !!d.attachOnly,
    gmailTo: d.gmailTo || ''
  };
}

router.post('/', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const settings = await getScanSettings();

  const conns = await pool.query(
    'SELECT provider, refresh_token_enc FROM email_connections WHERE user_id = $1',
    [userId]
  );
  if (!conns.rows.length) {
    return res.status(400).json({ error: 'לא חיברת אף תיבת מייל. עבור להגדרות → חיבורי מייל.' });
  }

  let added = 0;
  const errors: string[] = [];

  for (const conn of conns.rows) {
    const provider = getProvider(conn.provider);
    if (!provider) continue;
    try {
      // Always refresh to guarantee a valid access token; persist any rotated values.
      const tokens = await provider.refreshAccessToken(decrypt(conn.refresh_token_enc));
      await pool.query(
        `UPDATE email_connections
         SET access_token_enc = $1, expires_at = $2,
             refresh_token_enc = COALESCE($3, refresh_token_enc)
         WHERE user_id = $4 AND provider = $5`,
        [
          encrypt(tokens.accessToken),
          tokens.expiresAt,
          tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
          userId,
          conn.provider
        ]
      );

      const messages = await provider.searchMessages(tokens.accessToken, settings);
      const source = sourceFor(conn.provider);
      for (const m of messages) {
        // Reuse an existing person (dedup by email) or create one, then record
        // the inbound email as an application. ext_key keeps re-imports idempotent.
        const person = await findOrCreatePerson(pool, { name: m.name, email: m.email });
        const ins = await pool.query(
          `INSERT INTO applications
             (person_id, source, ext_key, subject, snippet, email_date, link,
              provider_message_id, has_attachment)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (ext_key) DO UPDATE SET
             provider_message_id = COALESCE(applications.provider_message_id, EXCLUDED.provider_message_id),
             has_attachment = EXCLUDED.has_attachment
           RETURNING (xmax = 0) AS inserted`,
          [person.id, source, m.extKey, m.subject, m.snippet, m.date || null, m.link,
           m.providerMessageId, m.hasAttachment]
        );
        // With DO UPDATE, rowCount is always 1; xmax = 0 marks a true insert (vs. a backfill).
        if (ins.rows[0]?.inserted) added += 1;
      }
    } catch (err: any) {
      errors.push(`${conn.provider}: ${err.message}`);
    }
  }

  res.json({ added, errors });
}));

export default router;
