import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { findOrCreatePerson, findPerson, normalizeEmail, normalizePhone } from '../lib/people.js';
import { getProvider } from '../providers/index.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { prepareCvParts, type GeminiPart } from '../lib/cv.js';
import { analyzeCv, draftLetter, isConfigured as geminiConfigured } from '../lib/gemini.js';
import type { CvAttachment } from '../providers/types.js';

const router = Router();

// candidate.source ('gmail'|'outlook') -> provider key ('google'|'microsoft')
function providerForSource(source: string): string {
  return source === 'gmail' ? 'google' : 'microsoft';
}

const STAGES = [
  'applied', 'phone', 'frontal', 'fit_client', 'cv_to_client',
  'client_interview', 'client_approved', 'contract', 'staffed', 'rejected'
];
const REJECTED_BY = ['us', 'client'];

// A "candidate" exposed to the frontend is an application joined with its person
// (and optionally its job). The flat shape keeps the existing board working.
const SELECT_CANDIDATE =
  `SELECT a.*, p.name, p.email, p.phone, p.referral,
          j.job_number, j.title AS job_title
   FROM applications a
   JOIN people p ON p.id = a.person_id
   LEFT JOIN jobs j ON j.id = a.job_id`;

function rowToCandidate(r: any) {
  return {
    id: String(r.id),
    personId: String(r.person_id),
    key: r.ext_key,
    source: r.source,
    name: r.name,
    email: r.email ?? '',
    phone: r.phone ?? '',
    referral: r.referral ?? '',
    subject: r.subject ?? '',
    snippet: r.snippet ?? '',
    date: r.email_date ? new Date(r.email_date).toISOString() : '',
    link: r.link ?? '',
    stage: r.stage,
    role: r.role ?? '',
    jobId: r.job_id != null ? String(r.job_id) : '',
    jobNumber: r.job_number ?? '',
    jobTitle: r.job_title ?? '',
    rejectionReason: r.rejection_reason ?? '',
    rejectedBy: r.rejected_by ?? '',
    rejectionLetterSent: !!r.rejection_letter_sent,
    notes: r.notes ?? '',
    ai: r.ai ?? null,
    hasAttachment: !!r.has_attachment,
    analyzedAt: r.analyzed_at ? new Date(r.analyzed_at).toISOString() : '',
    addedAt: r.added_at ? new Date(r.added_at).toISOString() : ''
  };
}

router.use(requireAuth);

router.get('/', asyncHandler(async (_req, res) => {
  const result = await pool.query(`${SELECT_CANDIDATE} ORDER BY a.added_at DESC`);
  res.json(result.rows.map(rowToCandidate));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, email, phone, role, stage, notes, jobId, referral, personId } = req.body ?? {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'נא להזין שם' });
  }
  const finalStage = STAGES.includes(stage) ? stage : 'applied';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let person;
    if (personId) {
      // Caller confirmed this is an existing person: add another application to them.
      const r = await client.query('SELECT * FROM people WHERE id = $1', [personId]);
      if (!r.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'מועמד לא נמצא' });
      }
      person = r.rows[0];
    } else {
      // Dedup: if someone already matches this email/phone, surface them instead
      // of silently creating a duplicate person.
      const dup = await findPerson(client, normalizeEmail(email), normalizePhone(phone));
      if (dup) {
        const apps = await client.query(
          `${SELECT_CANDIDATE} WHERE a.person_id = $1 ORDER BY a.added_at DESC`,
          [dup.id]
        );
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'מועמד קיים',
          duplicate: {
            person: { id: String(dup.id), name: dup.name, email: dup.email ?? '', phone: dup.phone ?? '' },
            applications: apps.rows.map(rowToCandidate)
          }
        });
      }
      person = await findOrCreatePerson(client, { name, email, phone, referral });
    }

    const inserted = await client.query(
      `INSERT INTO applications (person_id, job_id, source, role, stage, notes)
       VALUES ($1, $2, 'manual', $3, $4, $5)
       RETURNING id`,
      [person.id, jobId ? Number(jobId) : null, role ?? '', finalStage, notes ?? '']
    );
    const result = await client.query(`${SELECT_CANDIDATE} WHERE a.id = $1`, [inserted.rows[0].id]);
    await client.query('COMMIT');
    res.status(201).json(rowToCandidate(result.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const b = req.body ?? {};
  if (b.stage !== undefined && !STAGES.includes(b.stage)) {
    return res.status(400).json({ error: 'שלב לא תקין' });
  }
  if (b.rejectedBy !== undefined && b.rejectedBy !== '' && b.rejectedBy !== null && !REJECTED_BY.includes(b.rejectedBy)) {
    return res.status(400).json({ error: 'ערך "נפסל על ידי" לא תקין' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cur = await client.query('SELECT person_id FROM applications WHERE id = $1', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'מועמד לא נמצא' });
    }
    const personId = cur.rows[0].person_id;

    // Application-level fields.
    const aFields: string[] = [];
    const aValues: unknown[] = [];
    const setA = (col: string, val: unknown) => { aValues.push(val); aFields.push(`${col} = $${aValues.length}`); };
    if (b.role !== undefined) setA('role', b.role);
    if (b.stage !== undefined) setA('stage', b.stage);
    if (b.notes !== undefined) setA('notes', b.notes);
    if (b.jobId !== undefined) setA('job_id', b.jobId ? Number(b.jobId) : null);
    if (b.rejectionReason !== undefined) setA('rejection_reason', b.rejectionReason);
    if (b.rejectedBy !== undefined) setA('rejected_by', b.rejectedBy || null);
    if (b.rejectionLetterSent !== undefined) setA('rejection_letter_sent', !!b.rejectionLetterSent);
    if (aFields.length) {
      aValues.push(req.params.id);
      await client.query(
        `UPDATE applications SET ${aFields.join(', ')} WHERE id = $${aValues.length}`,
        aValues
      );
    }

    // Person-level fields.
    const pFields: string[] = [];
    const pValues: unknown[] = [];
    const setP = (col: string, val: unknown) => { pValues.push(val); pFields.push(`${col} = $${pValues.length}`); };
    if (b.name !== undefined) setP('name', String(b.name).trim());
    if (b.email !== undefined) setP('email', normalizeEmail(b.email));
    if (b.phone !== undefined) setP('phone', normalizePhone(b.phone));
    if (b.referral !== undefined) setP('referral', b.referral);
    if (pFields.length) {
      pValues.push(personId);
      await client.query(
        `UPDATE people SET ${pFields.join(', ')} WHERE id = $${pValues.length}`,
        pValues
      );
    }

    if (!aFields.length && !pFields.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'אין שדות לעדכון' });
    }

    const result = await client.query(`${SELECT_CANDIDATE} WHERE a.id = $1`, [req.params.id]);
    await client.query('COMMIT');
    res.json(rowToCandidate(result.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// AI analysis: read the CV (uploaded file or downloaded from the source email),
// score it against the assigned job via Gemini, and store the result on the application.
router.post('/:id/analyze', asyncHandler(async (req, res) => {
  if (!geminiConfigured()) {
    return res.status(400).json({ error: 'AI לא הוגדר בשרת (חסר GEMINI_API_KEY)' });
  }
  const userId = req.user!.userId;

  const r = await pool.query(
    `SELECT a.*, p.name AS person_name,
            j.job_number, j.title AS job_title, j.keywords AS job_keywords,
            j.description AS job_description,
            c.name AS client_name, c.looking_for AS client_looking_for
     FROM applications a
     JOIN people p ON p.id = a.person_id
     LEFT JOIN jobs j ON j.id = a.job_id
     LEFT JOIN clients c ON c.id = j.client_id
     WHERE a.id = $1`,
    [req.params.id]
  );
  const row = r.rows[0];
  if (!row) return res.status(404).json({ error: 'מועמד לא נמצא' });

  // 1) Obtain the CV: prefer an uploaded file, else download from the source email.
  let file: CvAttachment | null = null;
  const up = req.body?.file;
  if (up?.dataBase64) {
    file = { filename: up.filename || 'cv', mimeType: up.mimeType || '', dataBase64: up.dataBase64 };
  } else if (row.provider_message_id && row.source !== 'manual') {
    const provider = getProvider(providerForSource(row.source));
    const conn = await pool.query(
      'SELECT refresh_token_enc FROM email_connections WHERE user_id = $1 AND provider = $2',
      [userId, providerForSource(row.source)]
    );
    if (provider && conn.rows[0]) {
      const tokens = await provider.refreshAccessToken(decrypt(conn.rows[0].refresh_token_enc));
      await pool.query(
        `UPDATE email_connections
         SET access_token_enc = $1, expires_at = $2,
             refresh_token_enc = COALESCE($3, refresh_token_enc)
         WHERE user_id = $4 AND provider = $5`,
        [
          encrypt(tokens.accessToken), tokens.expiresAt,
          tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
          userId, providerForSource(row.source)
        ]
      );
      file = await provider.downloadCvAttachment(tokens.accessToken, row.provider_message_id);
    }
  }

  // 2) Build Gemini parts: the CV file, or fall back to the email text.
  const prepared = await prepareCvParts(file);
  let parts: GeminiPart[];
  if (prepared) {
    parts = prepared.parts;
  } else {
    const emailText = [row.subject, row.snippet, row.notes].filter(Boolean).join('\n').trim();
    if (!emailText) {
      return res.status(400).json({
        error: 'לא נמצא קובץ קו"ח לניתוח. צרף קובץ ידנית או ודא שלמייל מצורף קובץ.'
      });
    }
    parts = [{ text: 'אין קובץ קו"ח — הסתמך על טקסט המייל בלבד:\n' + emailText }];
  }

  // 3) Analyze and persist.
  const analysis = await analyzeCv(
    {
      jobNumber: row.job_number, title: row.job_title, keywords: row.job_keywords,
      description: row.job_description, clientName: row.client_name,
      clientLookingFor: row.client_looking_for
    },
    parts
  );
  const updated = await pool.query(
    `UPDATE applications SET ai = $1, analyzed_at = now() WHERE id = $2 RETURNING id`,
    [analysis, req.params.id]
  );
  if (!updated.rows[0]) return res.status(404).json({ error: 'מועמד לא נמצא' });

  const result = await pool.query(`${SELECT_CANDIDATE} WHERE a.id = $1`, [req.params.id]);
  res.json(rowToCandidate(result.rows[0]));
}));

// Draft a thank-you / rejection letter for the candidate (returned as text to
// copy into the user's own mail client — no sending permissions required).
router.post('/:id/letter', asyncHandler(async (req, res) => {
  if (!geminiConfigured()) {
    return res.status(400).json({ error: 'AI לא הוגדר בשרת (חסר GEMINI_API_KEY)' });
  }
  const kind = req.body?.kind === 'thankyou' ? 'thankyou' : 'rejection';
  const r = await pool.query(
    `SELECT p.name AS person_name, j.title AS job_title, a.rejection_reason
     FROM applications a JOIN people p ON p.id = a.person_id
     LEFT JOIN jobs j ON j.id = a.job_id
     WHERE a.id = $1`,
    [req.params.id]
  );
  const row = r.rows[0];
  if (!row) return res.status(404).json({ error: 'מועמד לא נמצא' });

  const text = await draftLetter(kind, {
    candidateName: row.person_name,
    jobTitle: row.job_title,
    reason: row.rejection_reason
  });
  res.json({ text });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM applications WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'מועמד לא נמצא' });
  res.status(204).end();
}));

// Delete all applications (clearAll). Orphaned people are left in place.
router.delete('/', asyncHandler(async (_req, res) => {
  await pool.query('DELETE FROM applications');
  res.status(204).end();
}));

export default router;
