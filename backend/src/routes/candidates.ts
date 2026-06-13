import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

const STAGES = ['new', 'screen', 'phone', 'interview', 'offer', 'hired', 'rejected'];

// Map a DB row to the shape the frontend expects (camelCase, string id).
// score/matched are intentionally omitted — the frontend derives them from the
// criteria + candidate text on every render (single source of truth).
function rowToCandidate(r: any) {
  return {
    id: String(r.id),
    key: r.ext_key,
    source: r.source,
    name: r.name,
    email: r.email ?? '',
    subject: r.subject ?? '',
    snippet: r.snippet ?? '',
    date: r.email_date ? new Date(r.email_date).toISOString() : '',
    link: r.link ?? '',
    stage: r.stage,
    role: r.role ?? '',
    notes: r.notes ?? '',
    ai: r.ai ?? null,
    addedAt: r.added_at ? new Date(r.added_at).toISOString() : ''
  };
}

router.use(requireAuth);

router.get('/', asyncHandler(async (_req, res) => {
  const result = await pool.query('SELECT * FROM candidates ORDER BY added_at DESC');
  res.json(result.rows.map(rowToCandidate));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, email, role, stage, notes } = req.body ?? {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'נא להזין שם' });
  }
  const finalStage = STAGES.includes(stage) ? stage : 'new';
  const result = await pool.query(
    `INSERT INTO candidates (source, name, email, role, stage, notes)
     VALUES ('manual', $1, $2, $3, $4, $5)
     RETURNING *`,
    [String(name).trim(), email ?? '', role ?? '', finalStage, notes ?? '']
  );
  res.status(201).json(rowToCandidate(result.rows[0]));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { name, email, role, stage, notes } = req.body ?? {};
  if (stage !== undefined && !STAGES.includes(stage)) {
    return res.status(400).json({ error: 'שלב לא תקין' });
  }

  // Build a dynamic update from only the provided fields.
  const fields: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, val: unknown) => { values.push(val); fields.push(`${col} = $${values.length}`); };
  if (name !== undefined) set('name', String(name).trim());
  if (email !== undefined) set('email', email);
  if (role !== undefined) set('role', role);
  if (stage !== undefined) set('stage', stage);
  if (notes !== undefined) set('notes', notes);

  if (!fields.length) return res.status(400).json({ error: 'אין שדות לעדכון' });

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE candidates SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'מועמד לא נמצא' });
  res.json(rowToCandidate(result.rows[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM candidates WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'מועמד לא נמצא' });
  res.status(204).end();
}));

// Delete all candidates (clearAll)
router.delete('/', asyncHandler(async (_req, res) => {
  await pool.query('DELETE FROM candidates');
  res.status(204).end();
}));

export default router;
