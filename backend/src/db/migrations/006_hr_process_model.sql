-- 006: adopt the recruiter's real process model (from the HBC recruitment
-- checklist workbook and the review meeting with the HR manager).
--
-- The pipeline was a single `stage` per application. The actual process tracks
-- four INDEPENDENT milestones plus a separate outcome status, because a
-- candidate can be interviewed and given a task while still not passed to the
-- client. A single stage cannot express that, so milestones become their own
-- columns and `stage` is kept for the board.
--
-- The workbook also carries the fields the dashboard is computed from — above
-- all salary expectation, which drives the average/median KPIs.

-- ---------- people: where the candidate lives ----------
ALTER TABLE people ADD COLUMN IF NOT EXISTS region VARCHAR(60);   -- מחוז: צפון / מרכז / דרום / שפלה / איו"ש
ALTER TABLE people ADD COLUMN IF NOT EXISTS city VARCHAR(120);    -- מגורים
ALTER TABLE people ADD COLUMN IF NOT EXISTS national_id VARCHAR(20); -- ת"ז, for matching returning candidates

-- Former employees who must not be re-hired. RealBoard stays the employee file;
-- this flag only lets the system raise a flag when such a person re-applies.
ALTER TABLE people ADD COLUMN IF NOT EXISTS do_not_rehire BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE people ADD COLUMN IF NOT EXISTS do_not_rehire_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_people_national_id
  ON people (national_id) WHERE national_id IS NOT NULL AND national_id <> '';

-- ---------- applications: milestones, outcome, commercials ----------
-- Milestones are independent checkboxes, exactly as the recruiter tracks them.
-- 'got_task' only applies to multi-discipline (רב תחומי) roles.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS interviewed_teams  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS got_task           BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS sent_to_client     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS client_approved    BOOLEAN NOT NULL DEFAULT false;

-- Outcome status — the recruiter's own vocabulary, kept as free text so the
-- list can grow without a migration. Seeded values (see app STATUSES):
-- בברור / נקבע ראיון / קו"ח הועבר ללקוח / אושר ע"י הלקוח / גוייס-ה /
-- צ"ש גבוהות / נפסל ע"י לקוח / לא תואמ-ת פרופיל / נפסל איזור ג"ג /
-- הסיר-ה מועמדות / נשלח מכתב שלילה / לקוח ביטל בקשה / לא מחפש-ת עבודה /
-- אין מענה / מועמד נטש תהליך
ALTER TABLE applications ADD COLUMN IF NOT EXISTS outcome_status VARCHAR(60);

ALTER TABLE applications ADD COLUMN IF NOT EXISTS salary_expectation NUMERIC(10,2); -- ציפיות שכר
ALTER TABLE applications ADD COLUMN IF NOT EXISTS job_scope       VARCHAR(40);      -- היקף משרה: מלאה / חלקית
ALTER TABLE applications ADD COLUMN IF NOT EXISTS employment_type VARCHAR(40);      -- שכיר / חשבונית
ALTER TABLE applications ADD COLUMN IF NOT EXISTS source_channel  VARCHAR(60);      -- מקור הגעה: JM / דרושים / פייסבוק-ווצאפ / מאיר ...
ALTER TABLE applications ADD COLUMN IF NOT EXISTS summary_text    TEXT;             -- תיאור: the recruiter's own write-up of the intro call
ALTER TABLE applications ADD COLUMN IF NOT EXISTS contacted_at    DATE;             -- תאריך השיחה, drives the "candidates over time" chart

CREATE INDEX IF NOT EXISTS idx_applications_outcome ON applications(outcome_status);
CREATE INDEX IF NOT EXISTS idx_applications_contacted ON applications(contacted_at);

-- Existing rows: the board stage is the only signal we have, so derive the
-- milestones from it rather than leaving everything false.
UPDATE applications SET interviewed_teams = true
  WHERE stage IN ('phone', 'frontal', 'fit_client', 'cv_to_client', 'client_interview',
                  'client_approved', 'contract', 'staffed');
UPDATE applications SET sent_to_client = true
  WHERE stage IN ('cv_to_client', 'client_interview', 'client_approved', 'contract', 'staffed');
UPDATE applications SET client_approved = true
  WHERE stage IN ('client_approved', 'contract', 'staffed');
UPDATE applications SET outcome_status = 'גוייס/ה' WHERE stage = 'staffed';

-- ---------- jobs: the client's request, in full ----------
-- status was 'open' | 'closed'; the real vocabulary is the request's lifecycle.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS request_date DATE;        -- תאריך בקשה
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS filled_date  DATE;        -- תאריך איוש
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status_reason TEXT;       -- סיבה/הסבר (why not filled)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS candidate_in_process TEXT; -- מועמד בתהליך (free text, may be several names)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contact TEXT;             -- איש קשר at the client, per request
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS start_date TEXT;          -- מועד תחילת העבודה ("מיידי", a date, ...)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS period TEXT;              -- תקופה / תקופת ההעסקה
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rate TEXT;                -- רייט
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_range TEXT;        -- טווח שכר
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS includes_car BOOLEAN;     -- כולל רכב
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS travel_between_sites BOOLEAN; -- נסיעות בין אתרים
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location TEXT;            -- מיקום (עיר/אתר/פרויקט)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_hours TEXT;          -- שעות עבודה
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_scope TEXT;           -- סוג משרה (מלאה/חלקית)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS shifts TEXT;              -- משמרות (שישי, לילה)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS equipment TEXT;           -- ציוד/ביגוד נלווה
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS years_experience TEXT;    -- שנות ניסיון
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS language TEXT;            -- שפה
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reports_to TEXT;          -- בכפיפות ל.. / עבודה בצוות או לבד
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS security_clearance TEXT;  -- סיווג בטחוני / תעודת יושר
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS extra_notes TEXT;         -- כל דבר אחר

-- The professional-requirements matrix the client fills per request. Stored as
-- JSONB ({"בנייה ענפית":"חובה","מדריך גובה":"יתרון"}) so requirements can be
-- added without a migration, and so matching can iterate over them generically.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requirements JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Existing jobs: 'open' becomes 'ממתין לאיוש', 'closed' becomes 'אויש'.
UPDATE jobs SET status = 'awaiting' WHERE status = 'open';
UPDATE jobs SET status = 'filled'   WHERE status = 'closed';
-- statuses from here on: awaiting | filled | not_filled | frozen
