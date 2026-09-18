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
        // Already imported? Just backfill attachment metadata — and skip person
        // creation entirely (otherwise email-less senders would leak a new
        // person row on every scan).
        const upd = await pool.query(
          `UPDATE applications
           SET provider_message_id = COALESCE(provider_message_id, $1),
               has_attachment = $2
           WHERE ext_key = $3`,
          [m.providerMessageId, m.hasAttachment, m.extKey]
        );
        if (upd.rowCount) continue;

        const client=await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT pg_advisory_xact_lock(726451, 1)');
          if((await client.query('SELECT 1 FROM applications WHERE ext_key=$1',[m.extKey])).rowCount) {
            await client.query('ROLLBACK');continue;
          }
          const person=await findOrCreatePerson(client,{name:m.name,email:m.email});
          const ins=await client.query(`INSERT INTO applications
            (person_id,source,ext_key,subject,snippet,email_date,link,provider_message_id,has_attachment)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(ext_key) DO NOTHING`,
            [person.id,source,m.extKey,m.subject,m.snippet,m.date||null,m.link,m.providerMessageId,m.hasAttachment]);
          await client.query('COMMIT');added+=ins.rowCount??0;
        } catch(err) {await client.query('ROLLBACK');throw err;} finally {client.release();}
      }
    } catch (err: any) {
      errors.push(`${conn.provider}: הסריקה נכשלה. יש לבדוק את החיבור ולהריץ שוב.`);
    }
  }

  res.json({ added, errors });
}));

export default router;
