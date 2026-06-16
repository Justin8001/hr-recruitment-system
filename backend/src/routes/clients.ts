import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

function rowToClient(r: any) {
  return {
    id: String(r.id),
    name: r.name,
    contactName: r.contact_name ?? '',
    contactEmail: r.contact_email ?? '',
    contactPhone: r.contact_phone ?? '',
    lookingFor: r.looking_for ?? '',
    notes: r.notes ?? '',
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : ''
  };
}

const COLS: Record<string, string> = {
  name: 'name',
  contactName: 'contact_name',
  contactEmail: 'contact_email',
  contactPhone: 'contact_phone',
  lookingFor: 'looking_for',
  notes: 'notes'
};

router.use(requireAuth);

router.get('/', asyncHandler(async (_req, res) => {
  const result = await pool.query('SELECT * FROM clients ORDER BY name ASC');
  res.json(result.rows.map(rowToClient));
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body ?? {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ error: 'נא להזין שם לקוח' });
  }
  const result = await pool.query(
    `INSERT INTO clients (name, contact_name, contact_email, contact_phone, looking_for, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      String(b.name).trim(),
      b.contactName ?? null,
      b.contactEmail ?? null,
      b.contactPhone ?? null,
      b.lookingFor ?? null,
      b.notes ?? null
    ]
  );
  res.status(201).json(rowToClient(result.rows[0]));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const b = req.body ?? {};
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(COLS)) {
    if (b[key] !== undefined) {
      values.push(key === 'name' ? String(b[key]).trim() : b[key]);
      fields.push(`${col} = $${values.length}`);
    }
  }
  if (!fields.length) return res.status(400).json({ error: 'אין שדות לעדכון' });

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE clients SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'לקוח לא נמצא' });
  res.json(rowToClient(result.rows[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'לקוח לא נמצא' });
  res.status(204).end();
}));

export default router;
