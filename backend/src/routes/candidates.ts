import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { findOrCreatePerson, findPerson, normalizeEmail, normalizePhone } from '../lib/people.js';

const router = Router();

const STAGES = ['new', 'screen', 'phone', 'interview', 'offer', 'hired', 'rejected'];
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
    notes: r.notes ?? '',
    ai: r.ai ?? null,
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
  const finalStage = STAGES.includes(stage) ? stage : 'new';

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
