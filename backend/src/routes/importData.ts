import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { normalizeEmail, normalizePhone } from '../lib/people.js';

const router = Router();
router.use(requireAuth);

/**
 * One-shot import of the recruiter's existing workbook (candidates + client
 * requests). Creates only — nothing is deleted or overwritten — and is safe to
 * run twice: a candidate already present by phone, or a request already present
 * by client + title + request date, is skipped rather than duplicated.
 */
router.post('/', asyncHandler(async (req, res) => {
  const candidates: any[] = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
  const jobs: any[] = Array.isArray(req.body?.jobs) ? req.body.jobs : [];
  if (!candidates.length && !jobs.length) {
    return res.status(400).json({ error: 'לא נשלחו נתונים לייבוא' });
  }

  const summary = {
    clientsCreated: 0,
    jobsCreated: 0, jobsSkipped: 0,
    candidatesCreated: 0, candidatesSkipped: 0
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clients are referenced by name from both sheets.
    const clientIdByName = new Map<string, number>();
    const existingClients = await client.query('SELECT id, name FROM clients');
    for (const r of existingClients.rows) clientIdByName.set(r.name.trim(), r.id);

    async function clientId(name?: string): Promise<number | null> {
      const n = (name || '').trim();
      if (!n) return null;
      if (clientIdByName.has(n)) return clientIdByName.get(n)!;
      const ins = await client.query('INSERT INTO clients (name) VALUES ($1) RETURNING id', [n]);
      clientIdByName.set(n, ins.rows[0].id);
      summary.clientsCreated++;
      return ins.rows[0].id;
    }

    // ---------- client requests ----------
    for (const j of jobs) {
      const cid = await clientId(j.clientName);

      // Identity is the row's position in the workbook. Matching on
      // title + client + date instead would merge two headcounts for the same
      // role on the same day — which previously lost an open request.
      let existing = null;
      if (j.importKey) {
        const r = await client.query('SELECT id FROM jobs WHERE import_key = $1 LIMIT 1', [j.importKey]);
        existing = r.rows[0] ?? null;
      }
      if (!existing) {
        // Rows created by the earlier, keyless import: adopt one rather than
        // insert a duplicate alongside it. Only rows not yet claimed qualify.
        const r = await client.query(
          `SELECT id FROM jobs
           WHERE title = $1 AND client_id IS NOT DISTINCT FROM $2
             AND request_date IS NOT DISTINCT FROM $3
             AND import_key IS NULL
           LIMIT 1`,
          [j.title, cid, j.requestDate || null]
        );
        if (r.rows[0]) {
          if (j.importKey) {
            await client.query('UPDATE jobs SET import_key = $1 WHERE id = $2', [j.importKey, r.rows[0].id]);
          }
          existing = r.rows[0];
        }
      }
      if (existing) { summary.jobsSkipped++; continue; }

      const seq = await client.query("SELECT nextval('jobs_number_seq') AS n");
      await client.query(
        `INSERT INTO jobs
           (job_number, title, client_id, status, keywords, description, requirements,
            request_date, filled_date, status_reason, candidate_in_process, contact,
            start_date, period, rate, salary_range, includes_car, travel_between_sites,
            location, work_hours, job_scope, shifts, equipment, years_experience,
            language, reports_to, security_clearance, extra_notes, import_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
        [
          String(seq.rows[0].n), j.title, cid, j.status || 'awaiting',
          j.keywords || null, j.description || null, j.requirements || {},
          j.requestDate || null, j.filledDate || null, j.statusReason || null,
          j.candidateInProcess || null, j.contact || null, j.startDate || null,
          j.period || j.employmentPeriod || null, j.rate || null, j.salaryRange || null,
          j.includesCar ?? null, j.travelBetweenSites ?? null, j.location || null,
          j.workHours || null, j.jobScope || null, j.shifts || null, j.equipment || null,
          j.yearsExperience || null, j.language || null, j.reportsTo || null,
          j.securityClearance || null, j.extraNotes || null, j.importKey || null
        ]
      );
      summary.jobsCreated++;
    }

    // ---------- candidates ----------
    for (const c of candidates) {
      const name = String(c.name || '').trim();
      if (!name) { summary.candidatesSkipped++; continue; }
      const phone = normalizePhone(c.phone);
      const email = normalizeEmail(c.email);

      // Already imported from this row?
      if (c.importKey) {
        const r = await client.query(
          'SELECT id FROM applications WHERE import_key = $1 LIMIT 1', [c.importKey]
        );
        if (r.rows[0]) { summary.candidatesSkipped++; continue; }
      }

      // Already here? Match on phone first (the workbook has no emails), then
      // on an exact name that came from this same import.
      let personId: number | null = null;
      if (phone) {
        const r = await client.query('SELECT id FROM people WHERE phone = $1 LIMIT 1', [phone]);
        if (r.rows[0]) personId = r.rows[0].id;
      }
      if (!personId && !phone) {
        const r = await client.query(
          'SELECT id FROM people WHERE lower(btrim(name)) = lower(btrim($1)) LIMIT 1', [name]
        );
        if (r.rows[0]) personId = r.rows[0].id;
      }

      if (personId) {
        // Fill in details the existing record is missing, then move on.
        await client.query(
          `UPDATE people
           SET region = COALESCE(region, $2), city = COALESCE(city, $3),
               phone = COALESCE(phone, $4)
           WHERE id = $1`,
          [personId, c.region || null, c.city || null, phone]
        );
        // Claim the row the earlier keyless import created for this person, so
        // the next run recognises it by key instead of re-matching on name.
        const hasApp = await client.query(
          `SELECT id, import_key FROM applications
           WHERE person_id = $1 AND source = 'excel' LIMIT 1`,
          [personId]
        );
        if (hasApp.rows[0]) {
          if (c.importKey && !hasApp.rows[0].import_key) {
            await client.query('UPDATE applications SET import_key = $1 WHERE id = $2',
              [c.importKey, hasApp.rows[0].id]);
          }
          summary.candidatesSkipped++;
          continue;
        }
      } else {
        const ins = await client.query(
          `INSERT INTO people (name, email, phone, region, city) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [name, email, phone, c.region || null, c.city || null]
        );
        personId = ins.rows[0].id;
      }

      const jobId = c.clientName
        ? (await client.query(
            `SELECT j.id FROM jobs j JOIN clients cl ON cl.id = j.client_id
             WHERE cl.name = $1 AND ($2 = '' OR j.title = $2) ORDER BY j.created_at DESC LIMIT 1`,
            [String(c.clientName).trim(), c.role || '']
          )).rows[0]?.id ?? null
        : null;

      await client.query(
        `INSERT INTO applications
           (person_id, job_id, source, role, stage, notes, summary_text,
            interviewed_teams, got_task, sent_to_client, client_approved,
            outcome_status, salary_expectation, job_scope, employment_type,
            source_channel, contacted_at, rejection_reason, import_key)
         VALUES ($1,$2,'excel',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          personId, jobId, c.role || '', stageFor(c), '', c.summaryText || null,
          !!c.interviewedTeams, !!c.gotTask, !!c.sentToClient, !!c.clientApproved,
          c.noAnswer ? 'אין מענה' : (c.outcomeStatus || null),
          c.salaryExpectation ?? null, c.jobScope || null, c.employmentType || null,
          c.sourceChannel || null, c.contactedAt || null, c.rejectionReason || null,
          c.importKey || null
        ]
      );
      summary.candidatesCreated++;
    }

    await client.query('COMMIT');
    res.json(summary);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

/** Best board stage for an imported row, derived from its milestones/outcome. */
function stageFor(c: any): string {
  const s = String(c.outcomeStatus || '');
  if (s.includes('גוייס')) return 'staffed';
  if (s.includes('נפסל') || s.includes('שלילה') || s.includes('הסיר') ||
      s.includes('לא תואמ') || s.includes('לא מחפש') || s.includes('ביטל') ||
      s.includes('נטש') || s.includes('צ"ש')) return 'rejected';
  if (c.clientApproved) return 'client_approved';
  if (c.sentToClient) return 'cv_to_client';
  if (c.interviewedTeams) return 'phone';
  return 'applied';
}

export default router;
