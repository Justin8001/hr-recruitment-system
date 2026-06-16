import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

const TRACKS = ['office', 'multi', 'project'];
const STATUSES = ['open', 'closed'];

function rowToJob(r: any) {
  return {
    id: String(r.id),
    jobNumber: r.job_number,
    title: r.title,
    clientId: r.client_id != null ? String(r.client_id) : '',
    clientName: r.client_name ?? '',
    track: r.track ?? '',
    status: r.status,
    keywords: r.keywords ?? '',
    description: r.description ?? '',
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : ''
  };
}

const SELECT_WITH_CLIENT =
  `SELECT j.*, c.name AS client_name
   FROM jobs j LEFT JOIN clients c ON c.id = j.client_id`;

router.use(requireAuth);

router.get('/', asyncHandler(async (_req, res) => {
  const result = await pool.query(`${SELECT_WITH_CLIENT} ORDER BY j.created_at DESC`);
  res.json(result.rows.map(rowToJob));
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body ?? {};
  if (!b.title || !String(b.title).trim()) {
    return res.status(400).json({ error: 'נא להזין כותרת משרה' });
  }
  const track = TRACKS.includes(b.track) ? b.track : null;
  const status = STATUSES.includes(b.status) ? b.status : 'open';

  const seq = await pool.query("SELECT nextval('jobs_number_seq') AS n");
  const jobNumber = String(seq.rows[0].n);

  const inserted = await pool.query(
    `INSERT INTO jobs (job_number, title, client_id, track, status, keywords, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      jobNumber,
      String(b.title).trim(),
      b.clientId ? Number(b.clientId) : null,
      track,
      status,
      b.keywords ?? null,
      b.description ?? null
    ]
  );
  const result = await pool.query(`${SELECT_WITH_CLIENT} WHERE j.id = $1`, [inserted.rows[0].id]);
  res.status(201).json(rowToJob(result.rows[0]));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const b = req.body ?? {};
  if (b.track !== undefined && b.track !== '' && b.track !== null && !TRACKS.includes(b.track)) {
    return res.status(400).json({ error: 'מסלול לא תקין' });
  }
  if (b.status !== undefined && !STATUSES.includes(b.status)) {
    return res.status(400).json({ error: 'סטטוס לא תקין' });
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, val: unknown) => { values.push(val); fields.push(`${col} = $${values.length}`); };
  if (b.title !== undefined) set('title', String(b.title).trim());
  if (b.clientId !== undefined) set('client_id', b.clientId ? Number(b.clientId) : null);
  if (b.track !== undefined) set('track', b.track || null);
  if (b.status !== undefined) set('status', b.status);
  if (b.keywords !== undefined) set('keywords', b.keywords);
  if (b.description !== undefined) set('description', b.description);

  if (!fields.length) return res.status(400).json({ error: 'אין שדות לעדכון' });

  values.push(req.params.id);
  const updated = await pool.query(
    `UPDATE jobs SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING id`,
    values
  );
  if (!updated.rows[0]) return res.status(404).json({ error: 'משרה לא נמצאה' });
  const result = await pool.query(`${SELECT_WITH_CLIENT} WHERE j.id = $1`, [req.params.id]);
  res.json(rowToJob(result.rows[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM jobs WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'משרה לא נמצאה' });
  res.status(204).end();
}));

export default router;
