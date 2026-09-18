import { validateInput } from '../middleware/validation.js';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { rankCandidates } from '../lib/matching.js';

const router = Router();

const TRACKS = ['office', 'multi', 'project'];
// The client request's lifecycle, matching how the recruiter reports it.
const STATUSES = ['awaiting', 'filled', 'not_filled', 'frozen'];

// Plain text/boolean job fields, all optional. Listed once and reused by the
// create/update handlers so adding a field to the request form is a one-liner.
const TEXT_FIELDS: Record<string, string> = {
  statusReason: 'status_reason', candidateInProcess: 'candidate_in_process',
  contact: 'contact', startDate: 'start_date', period: 'period', rate: 'rate',
  salaryRange: 'salary_range', location: 'location', workHours: 'work_hours',
  jobScope: 'job_scope', shifts: 'shifts', equipment: 'equipment',
  yearsExperience: 'years_experience', language: 'language',
  reportsTo: 'reports_to', securityClearance: 'security_clearance',
  extraNotes: 'extra_notes'
};
const BOOL_FIELDS: Record<string, string> = {
  includesCar: 'includes_car', travelBetweenSites: 'travel_between_sites'
};
const DATE_FIELDS: Record<string, string> = {
  requestDate: 'request_date', filledDate: 'filled_date'
};

function iso(d: any) { return d ? new Date(d).toISOString().slice(0, 10) : ''; }

/** Months between request and fill — the "ממוצע זמן גיוס" KPI. */
function fillMonths(r: any): number | null {
  if (!r.request_date || !r.filled_date) return null;
  const days = (new Date(r.filled_date).getTime() - new Date(r.request_date).getTime()) / 864e5;
  return days < 0 ? null : Math.round((days / 30.44) * 100) / 100;
}

function rowToJob(r: any) {
  const out: any = {
    id: String(r.id),
    jobNumber: r.job_number,
    title: r.title,
    clientId: r.client_id != null ? String(r.client_id) : '',
    clientName: r.client_name ?? '',
    track: r.track ?? '',
    status: r.status,
    keywords: r.keywords ?? '',
    description: r.description ?? '',
    requirements: r.requirements ?? {},
    requestDate: iso(r.request_date),
    filledDate: iso(r.filled_date),
    fillMonths: fillMonths(r),
    includesCar: r.includes_car,
    travelBetweenSites: r.travel_between_sites,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : ''
  };
  for (const [api, col] of Object.entries(TEXT_FIELDS)) out[api] = r[col] ?? '';
  return out;
}

const SELECT_WITH_CLIENT =
  `SELECT j.*, c.name AS client_name
   FROM jobs j LEFT JOIN clients c ON c.id = j.client_id`;

router.use(requireAuth);
router.use(validateInput);
router.param('id', (req,res,next)=>validateInput(req,res,next));

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
  const status = STATUSES.includes(b.status) ? b.status : 'awaiting';

  const seq = await pool.query("SELECT nextval('jobs_number_seq') AS n");
  const jobNumber = String(seq.rows[0].n);

  const cols = ['job_number', 'title', 'client_id', 'track', 'status', 'keywords', 'description', 'requirements'];
  const vals: unknown[] = [
    jobNumber,
    String(b.title).trim(),
    b.clientId ? Number(b.clientId) : null,
    track,
    status,
    b.keywords ?? null,
    b.description ?? null,
    b.requirements && typeof b.requirements === 'object' ? b.requirements : {}
  ];
  for (const [api, col] of Object.entries(TEXT_FIELDS)) {
    if (b[api] !== undefined) { cols.push(col); vals.push(b[api] || null); }
  }
  for (const [api, col] of Object.entries(BOOL_FIELDS)) {
    if (b[api] !== undefined) { cols.push(col); vals.push(b[api] === null ? null : !!b[api]); }
  }
  for (const [api, col] of Object.entries(DATE_FIELDS)) {
    if (b[api] !== undefined) { cols.push(col); vals.push(b[api] || null); }
  }
  const inserted = await pool.query(
    `INSERT INTO jobs (${cols.join(', ')})
     VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING id`,
    vals
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
  if (b.requirements !== undefined && typeof b.requirements === 'object') {
    set('requirements', b.requirements);
  }
  for (const [api, col] of Object.entries(TEXT_FIELDS)) {
    if (b[api] !== undefined) set(col, b[api] || null);
  }
  for (const [api, col] of Object.entries(BOOL_FIELDS)) {
    if (b[api] !== undefined) set(col, b[api] === null ? null : !!b[api]);
  }
  for (const [api, col] of Object.entries(DATE_FIELDS)) {
    if (b[api] !== undefined) set(col, b[api] || null);
  }
  // Filling a request stamps the date the KPI is measured from.
  if (b.status === 'filled' && b.filledDate === undefined) set('filled_date', new Date());

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

// Rank the existing candidate pool against this job.
// This is the direction the recruiter actually works in: a request comes in and
// she wants to know who she already has, before posting an ad at all.
router.post('/:id/match', asyncHandler(async (req, res) => {
  const jr = await pool.query(`${SELECT_WITH_CLIENT} WHERE j.id = $1`, [req.params.id]);
  if (!jr.rows[0]) return res.status(404).json({ error: 'משרה לא נמצאה' });
  const job = rowToJob(jr.rows[0]);

  // One row per person — the same human applying twice shouldn't fill the list.
  const cr = await pool.query(
    `SELECT DISTINCT ON (a.person_id)
            a.id, a.role, a.salary_expectation, a.ai, a.stage, a.outcome_status,
            a.summary_text, a.notes,
            p.name, p.region, p.city, p.do_not_rehire
     FROM applications a JOIN people p ON p.id = a.person_id
     ORDER BY a.person_id, (a.job_id = $1) DESC NULLS LAST, (a.ai IS NOT NULL) DESC, a.added_at DESC, a.id DESC`, [req.params.id]
  );

  const pool_ = cr.rows.map(r => ({
    id: String(r.id),
    name: r.name,
    role: r.role ?? '',
    region: r.region ?? '',
    city: r.city ?? '',
    salaryExpectation: r.salary_expectation != null ? Number(r.salary_expectation) : null,
    summaryText: r.summary_text ?? '',
    notes: r.notes ?? '',
    ai: r.ai
  }));
  const byId = new Map(cr.rows.map(r => [String(r.id), r]));

  const requested=Number(req.body?.limit ?? 25);
  if(!Number.isInteger(requested)||requested<1||requested>100) return res.status(400).json({code:'INVALID_LIMIT',error:'מספר התוצאות חייב להיות בין 1 ל-100'});
  const ranked = rankCandidates(job as any, pool_).slice(0, requested);
  res.json({
    job: { id: job.id, jobNumber: job.jobNumber, title: job.title, clientName: job.clientName },
    results: ranked.map(m => {
      const r = byId.get(m.candidateId);
      return {
        ...m,
        name: r?.name ?? '',
        role: r?.role ?? '',
        city: r?.city ?? '',
        region: r?.region ?? '',
        stage: r?.stage ?? '',
        outcomeStatus: r?.outcome_status ?? '',
        salaryExpectation: r?.salary_expectation != null ? Number(r.salary_expectation) : null,
        analyzed: !!r?.ai,
        // A returning candidate the company decided not to re-hire.
        doNotRehire: !!r?.do_not_rehire
      };
    })
  });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM jobs WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'משרה לא נמצאה' });
  res.status(204).end();
}));

export default router;
