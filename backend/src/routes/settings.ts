import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Mirrors DEFAULT_SETTINGS from the original artifact.
const DEFAULT_SETTINGS = {
  query: 'קורות חיים, קו"ח, resume, CV, מועמדות, מועמד למשרת',
  days: 60,
  gmail: false,
  outlook: true,
  attachOnly: false,
  outlookMailbox: '',
  gmailTo: '',
  criteria: [
    { name: 'ניסיון בתחום', keywords: 'ניסיון, שנות ניסיון, experience' },
    { name: 'השכלה / הסמכות', keywords: 'תואר, הסמכה, תעודה, הנדסאי, מהנדס, B.A, B.Sc' },
    { name: 'מילות מפתח לתפקיד', keywords: '' },
    { name: 'מיקום / זמינות', keywords: 'זמין מיידית, זמינות מיידית, מגורים, אזור' }
  ]
};

router.use(requireAuth);

router.get('/', asyncHandler(async (_req, res) => {
  const result = await pool.query('SELECT data FROM app_settings WHERE id = 1');
  const data = result.rows[0]?.data;
  res.json({ ...DEFAULT_SETTINGS, ...(data ?? {}) });
}));

router.put('/', asyncHandler(async (req, res) => {
  const incoming = req.body ?? {};
  const merged = { ...DEFAULT_SETTINGS, ...incoming };
  await pool.query(
    `INSERT INTO app_settings (id, data) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [merged]
  );
  res.json(merged);
}));

export default router;
