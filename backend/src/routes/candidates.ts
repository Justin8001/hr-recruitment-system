import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { findOrCreatePerson, findPerson, normalizeEmail, normalizePhone, lockPeople, preferredName } from '../lib/people.js';
import { getProvider } from '../providers/index.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { prepareCvParts, type GeminiPart } from '../lib/cv.js';
import { analyzeCv, draftLetter, isConfigured as geminiConfigured } from '../lib/gemini.js';
import type { CvAttachment } from '../providers/types.js';
import { HttpError } from '../lib/errors.js';
import { validateInput } from '../middleware/validation.js';
import { appendHistory, readNotes } from '../lib/history.js';

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
          p.version AS person_version, p.region, p.city, p.national_id, p.do_not_rehire, p.do_not_rehire_reason,
          j.job_number, j.title AS job_title, j.track AS job_track,
          j.client_id, cl.name AS client_name
   FROM applications a
   JOIN people p ON p.id = a.person_id
   LEFT JOIN jobs j ON j.id = a.job_id
   LEFT JOIN clients cl ON cl.id = j.client_id`;

function rowToCandidate(r: any) {
  return {
    id: String(r.id),
    personId: String(r.person_id),
    version: String(r.version), personVersion: String(r.person_version),
    historyWarnings: readNotes(r.notes).warnings,
    key: r.ext_key,
    source: r.source,
    name: r.name,
    email: r.email ?? '',
    phone: r.phone ?? '',
    referral: r.referral ?? '',
    region: r.region ?? '',
    city: r.city ?? '',
    nationalId: r.national_id ?? '',
    doNotRehire: !!r.do_not_rehire,
    doNotRehireReason: r.do_not_rehire_reason ?? '',
    // Independent process milestones — a candidate can be interviewed and given
    // a task while still not passed on to the client.
    interviewedTeams: !!r.interviewed_teams,
    gotTask: !!r.got_task,
    sentToClient: !!r.sent_to_client,
    clientApproved: !!r.client_approved,
    outcomeStatus: r.outcome_status ?? '',
    salaryExpectation: r.salary_expectation != null ? Number(r.salary_expectation) : null,
    jobScope: r.job_scope ?? '',
    employmentType: r.employment_type ?? '',
    sourceChannel: r.source_channel ?? '',
    summaryText: r.summary_text ?? '',
    contactedAt: r.contacted_at ? new Date(r.contacted_at).toISOString().slice(0, 10) : '',
    jobTrack: r.job_track ?? '',
    subject: r.subject ?? '',
    snippet: r.snippet ?? '',
    date: r.email_date ? new Date(r.email_date).toISOString() : '',
    link: r.link ?? '',
    stage: r.stage,
    role: r.role ?? '',
    jobId: r.job_id != null ? String(r.job_id) : '',
    jobNumber: r.job_number ?? '',
    jobTitle: r.job_title ?? '',
    clientId: r.client_id != null ? String(r.client_id) : '',
    clientName: r.client_name ?? '',
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
router.use(validateInput);
router.param('id', (req, res, next) => validateInput(req, res, next));

router.get('/', asyncHandler(async (_req, res) => {
  const result = await pool.query(`${SELECT_CANDIDATE} ORDER BY a.added_at DESC`);
  res.json(result.rows.map(rowToCandidate));
}));

// The AI already extracted the candidate's real name/email/phone and we stored
// it inside the analysis. When the rename right after import didn't stick, that
// data is still there — so names can be repaired from it without re-uploading.
const REPAIR_QUERY = `SELECT DISTINCT ON (p.id) p.*, a.ai, a.analyzed_at
  FROM people p JOIN applications a ON a.person_id=p.id
  WHERE COALESCE(a.ai->>'candidateName','') <> ''
  ORDER BY p.id, (a.ai->>'candidateName' ~ '[א-ת]') DESC, a.analyzed_at DESC NULLS LAST, a.id DESC`;
router.get('/repairable-names', asyncHandler(async (_req,res) => {
  const rows=(await pool.query(REPAIR_QUERY)).rows;
  const changes=rows.map(p=>({from:p.name,to:preferredName([p.ai.candidateName,p.name])}))
    .map(c => /[א-ת]/.test(c.from) ? {...c,to:c.from} : c).filter(c=>c.from!==c.to);
  res.json({count:changes.length,samples:changes.slice(0,8)});
}));
router.post('/repair-names', asyncHandler(async (_req,res) => {
  const client=await pool.connect(); let renamed=0;
  try {
    await client.query('BEGIN'); await lockPeople(client);
    const rows=(await client.query(REPAIR_QUERY)).rows;
    for(const p of rows) {
      const name=/[א-ת]/.test(p.name) ? p.name : preferredName([p.ai.candidateName,p.name]);
      const email=normalizeEmail(p.ai.candidateEmail), phone=normalizePhone(p.ai.candidatePhone);
      const emailFree=!email || !(await client.query('SELECT 1 FROM people WHERE lower(email)=$1 AND id<>$2',[email,p.id])).rowCount;
      const phoneFree=!phone || !(await client.query('SELECT 1 FROM people WHERE phone=$1 AND id<>$2',[phone,p.id])).rowCount;
      await client.query(`UPDATE people SET name=$2, email=COALESCE(NULLIF(email,''),$3), phone=COALESCE(NULLIF(phone,''),$4) WHERE id=$1`,
        [p.id,name,emailFree?email:null,phoneFree?phone:null]);
      if(name!==p.name) renamed++;
    }
    await client.query('COMMIT'); res.json({renamed});
  } catch(err) {await client.query('ROLLBACK'); throw err;} finally {client.release();}
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, email, phone, role, stage, notes, jobId, referral, personId } = req.body ?? {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'נא להזין שם' });
  }
  if(stage!==undefined&&!STAGES.includes(stage)) throw new HttpError(400,'INVALID_STAGE','שלב לא תקין');
  if(req.body.rejectedBy && !REJECTED_BY.includes(req.body.rejectedBy)) throw new HttpError(400,'INVALID_REJECTED_BY','ערך נפסל על ידי לא תקין');
  const finalStage = stage || 'applied';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockPeople(client);

    let person;
    if (personId) {
      // Caller confirmed this is an existing person: add another application to them.
      const r = await client.query('SELECT * FROM people WHERE id = $1 FOR UPDATE', [personId]);
      if (!r.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'מועמד לא נמצא' });
      }
      person = r.rows[0];
      if (String(req.body.expectedPersonVersion || '') !== String(person.version)) throw new HttpError(409, 'PERSON_CHANGED', 'פרטי האדם עודכנו. יש לרענן לפני הוספת הגשה.');
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
            person: { id: String(dup.id), name: dup.name, version: String(dup.version), email: dup.email ?? '', phone: dup.phone ?? '' },
            applications: apps.rows.map(rowToCandidate)
          }
        });
      }
      person = await findOrCreatePerson(client, { name, email, phone, referral });
    }

    const b = req.body ?? {};
    const salary = Number(b.salaryExpectation);
    const inserted = await client.query(
      `INSERT INTO applications
         (person_id, job_id, source, role, stage, notes,
          salary_expectation, job_scope, employment_type, source_channel,
          summary_text, contacted_at, outcome_status)
       VALUES ($1, $2, 'manual', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        person.id, jobId ? Number(jobId) : null, role ?? '', finalStage, notes ?? '',
        b.salaryExpectation === '' || b.salaryExpectation === undefined || Number.isNaN(salary) ? null : salary,
        b.jobScope || null, b.employmentType || null, b.sourceChannel || null,
        b.summaryText || null, b.contactedAt || null, b.outcomeStatus || null
      ]
    );
    const id = inserted.rows[0].id;
    const appCols: Record<string, string> = {interviewedTeams:'interviewed_teams', gotTask:'got_task',
      sentToClient:'sent_to_client', clientApproved:'client_approved', rejectionReason:'rejection_reason',
      rejectedBy:'rejected_by', rejectionLetterSent:'rejection_letter_sent'};
    const extra = Object.entries(appCols).filter(([key]) => b[key] !== undefined);
    if (extra.length) await client.query(`UPDATE applications SET ${extra.map(([,col],i) => `${col} = $${i+2}`).join(', ')} WHERE id = $1`,
      [id, ...extra.map(([key]) => b[key] === '' ? null : b[key])]);
    const personCols: Record<string,string> = {name:'name', email:'email', phone:'phone', referral:'referral', region:'region', city:'city', nationalId:'national_id', doNotRehire:'do_not_rehire', doNotRehireReason:'do_not_rehire_reason'};
    const pe = Object.entries(personCols).filter(([key,col]) => b[key] !== undefined && (!personId || !person[col]));
    if (pe.length) await client.query(`UPDATE people SET ${pe.map(([,col],i) => `${col} = $${i+2}`).join(', ')} WHERE id = $1`,
      [person.id, ...pe.map(([key]) => key === 'email' ? normalizeEmail(b[key]) : key === 'phone' ? normalizePhone(b[key]) : b[key])]);
    const initial = rowToCandidate((await client.query(`${SELECT_CANDIDATE} WHERE a.id = $1`, [id])).rows[0]);
    const notesWithHistory = appendHistory({...initial, notes: '', id}, {notes: b.notes || ''}, req.user!.username);
    await client.query('UPDATE applications SET notes = $2 WHERE id = $1', [id, notesWithHistory]);
    const result = await client.query(`${SELECT_CANDIDATE} WHERE a.id = $1`, [id]);
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
    await lockPeople(client);

    const cur = await client.query(`${SELECT_CANDIDATE} WHERE a.id = $1 FOR UPDATE OF a, p`, [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'מועמד לא נמצא' });
    }
    const personId = cur.rows[0].person_id;
    const current = rowToCandidate(cur.rows[0]);
    if (b.expectedVersion === undefined || b.expectedPersonVersion === undefined)
      throw new HttpError(428, 'VERSION_REQUIRED', 'יש לרענן את האתר לפני השמירה.');
    if (String(b.expectedVersion) !== current.version || String(b.expectedPersonVersion) !== current.personVersion)
      throw new HttpError(409, 'RECORD_CHANGED', 'הכרטיס או פרטי האדם עודכנו מאז הפתיחה. יש להעתיק את השינויים ולרענן.');
    if (b.jobId !== undefined && String(b.jobId || '') !== current.jobId) {
      const job = b.jobId ? (await client.query(
        'SELECT j.title, j.client_id, c.name AS client_name FROM jobs j LEFT JOIN clients c ON c.id = j.client_id WHERE j.id = $1', [b.jobId]
      )).rows[0] : null;
      b.jobTitle = job?.title || '';
      b.clientId = job?.client_id != null ? String(job.client_id) : '';
      b.clientName = job?.client_name || '';
    }
    if (b.expectedNotes !== undefined && String(b.expectedNotes) !== current.notes) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'הכרטיס עודכן מאז שנפתח. העתק את התיעוד החדש, רענן את המערכת ופתח את הכרטיס מחדש לפני שמירה.' });
    }
    try {
      b.notes = appendHistory(current, b, req.user?.username || '');
    } catch {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'ההיסטוריה אינה תקינה. השמירה נעצרה כדי לא לאבד תיעוד קיים.' });
    }

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
    // Process milestones and the intro-call details the recruiter records.
    if (b.interviewedTeams !== undefined) setA('interviewed_teams', !!b.interviewedTeams);
    if (b.gotTask !== undefined) setA('got_task', !!b.gotTask);
    if (b.sentToClient !== undefined) setA('sent_to_client', !!b.sentToClient);
    if (b.clientApproved !== undefined) setA('client_approved', !!b.clientApproved);
    if (b.outcomeStatus !== undefined) setA('outcome_status', b.outcomeStatus || null);
    if (b.salaryExpectation !== undefined) {
      const n = Number(b.salaryExpectation);
      setA('salary_expectation', b.salaryExpectation === '' || Number.isNaN(n) ? null : n);
    }
    if (b.jobScope !== undefined) setA('job_scope', b.jobScope || null);
    if (b.employmentType !== undefined) setA('employment_type', b.employmentType || null);
    if (b.sourceChannel !== undefined) setA('source_channel', b.sourceChannel || null);
    if (b.summaryText !== undefined) setA('summary_text', b.summaryText);
    if (b.contactedAt !== undefined) setA('contacted_at', b.contactedAt || null);
    if (aFields.length) {
      aValues.push(req.params.id);
      await client.query(
        `UPDATE applications SET ${aFields.join(', ')} WHERE id = $${aValues.length}`,
        aValues
      );
    }

    // Contact changes obey the same serialized identity checks as creation.
    if(b.email!==undefined || b.phone!==undefined) {
      const match=await findPerson(client,normalizeEmail(b.email===undefined?current.email:b.email),normalizePhone(b.phone===undefined?current.phone:b.phone));
      if(match && String(match.id)!==String(personId)) throw new HttpError(409,'DUPLICATE_CONTACT','פרטי הקשר שייכים לאדם אחר. יש לאחד כפילויות במקום לדרוס.');
    }
    // Person-level fields.
    const pFields: string[] = [];
    const pValues: unknown[] = [];
    const setP = (col: string, val: unknown) => { pValues.push(val); pFields.push(`${col} = $${pValues.length}`); };
    if (b.name !== undefined) setP('name', String(b.name).trim());
    if (b.email !== undefined) setP('email', normalizeEmail(b.email));
    if (b.phone !== undefined) setP('phone', normalizePhone(b.phone));
    if (b.referral !== undefined) setP('referral', b.referral);
    if (b.region !== undefined) setP('region', b.region || null);
    if (b.city !== undefined) setP('city', b.city || null);
    if (b.nationalId !== undefined) setP('national_id', b.nationalId || null);
    if (b.doNotRehire !== undefined) setP('do_not_rehire', !!b.doNotRehire);
    if (b.doNotRehireReason !== undefined) setP('do_not_rehire_reason', b.doNotRehireReason || null);
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
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'האימייל הזה כבר שייך למועמד אחר במערכת' });
    }
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
      try {
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
      } catch (err: any) {
        return res.status(502).json({ error: 'שגיאה בהורדת קורות החיים. יש לבדוק את חיבור המייל.' });
      }
    }
  }

  // 2) Build Gemini parts: the CV file, or fall back to the email text.
  const prepared = await prepareCvParts(file);
  let parts: GeminiPart[];
  if (prepared) {
    parts = prepared.parts;
  } else if (req.body?.fileOnly) {
    // Batch callers ask for this: no real CV file means nothing worth reading,
    // so skip the candidate cheaply instead of burning a Gemini call on a snippet.
    return res.status(422).json({ error: 'אין קובץ קו"ח במייל הזה', noFile: true });
  } else {
    const emailText = [row.subject, row.snippet, row.notes].filter(Boolean).join('\n').trim();
    if (!emailText) {
      return res.status(400).json({
        error: 'לא נמצא קובץ קו"ח לניתוח. צרף קובץ ידנית או ודא שלמייל מצורף קובץ.'
      });
    }
    parts = [{ text: 'אין קובץ קו"ח — הסתמך על טקסט המייל בלבד:\n' + emailText }];
  }

  // 3) Analyze and persist. Surface Gemini failures with their message
  // (timeout, quota, bad key) instead of a generic 500.
  // autoMatch: let the AI pick which open job this CV fits, instead of scoring
  // against a job the user had to choose up front.
  let analysis;
  // Job assignment and role classification are recruiter-owned, even when an
  // older frontend still sends autoMatch: true.
  try {
    analysis = await analyzeCv({
      jobNumber: row.job_number, title: row.job_title, keywords: row.job_keywords,
      description: row.job_description, clientName: row.client_name,
      clientLookingFor: row.client_looking_for
    }, parts);
  } catch (err: any) {
    return res.status(502).json({ error: 'שירות הניתוח אינו זמין כרגע. יש לבדוק את הגדרת השירות ולנסות שוב.' });
  }
  const sets = ['ai = $1', 'analyzed_at = now()'];
  const values: unknown[] = [analysis];
  values.push(req.params.id);
  const updated = await pool.query(
    `UPDATE applications SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id`,
    values
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

  try {
    const text = await draftLetter(kind, {
      candidateName: row.person_name,
      jobTitle: row.job_title,
      reason: row.rejection_reason
    });
    res.json({ text });
  } catch (err: any) {
    res.status(502).json({ error: 'שירות הניסוח אינו זמין כרגע.' });
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
