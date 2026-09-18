import { HttpError } from '../lib/errors.js';
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
  if(!incoming || typeof incoming!=='object' || Array.isArray(incoming)) throw new HttpError(400,'INVALID_SETTINGS','הגדרות לא תקינות');
  if(incoming.days!==undefined && (!Number.isInteger(Number(incoming.days)) || Number(incoming.days)<1 || Number(incoming.days)>3650)) throw new HttpError(400,'INVALID_SETTINGS','טווח ימים לא תקין');
  for(const key of ['query','outlookMailbox','gmailTo']) if(incoming[key]!==undefined && (typeof incoming[key]!=='string'||incoming[key].length>2000)) throw new HttpError(400,'INVALID_SETTINGS','ערך הגדרה לא תקין');
  for(const key of ['gmail','outlook','attachOnly']) if(incoming[key]!==undefined&&typeof incoming[key]!=='boolean') throw new HttpError(400,'INVALID_SETTINGS','ערך הגדרה לא תקין');
  if(incoming.criteria!==undefined && (!Array.isArray(incoming.criteria)||incoming.criteria.length>100||incoming.criteria.some((c:any)=>!c||typeof c.name!=='string'||typeof c.keywords!=='string'||c.name.length>200||c.keywords.length>4000))) throw new HttpError(400,'INVALID_SETTINGS','קריטריונים לא תקינים');
  const merged = { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.keys(DEFAULT_SETTINGS).filter(k=>incoming[k]!==undefined).map(k=>[k,incoming[k]])) };
  await pool.query(
    `INSERT INTO app_settings (id, data) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [merged]
  );
  res.json(merged);
}));

export default router;
