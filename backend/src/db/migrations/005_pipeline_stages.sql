-- 005: richer recruitment pipeline (Wave 3).
-- Replaces the generic 7-stage model with stages that mirror the real process,
-- migrates existing stage values, and adds a flag for tracking whether a
-- rejection letter was sent (for real-time cuts like "how many got a letter").

ALTER TABLE applications ADD COLUMN IF NOT EXISTS rejection_letter_sent BOOLEAN NOT NULL DEFAULT false;

-- Map old stage values onto the new pipeline.
UPDATE applications SET stage = 'applied'  WHERE stage IN ('new', 'screen');
UPDATE applications SET stage = 'frontal'  WHERE stage = 'interview';
UPDATE applications SET stage = 'contract' WHERE stage = 'offer';
UPDATE applications SET stage = 'staffed'  WHERE stage = 'hired';
-- 'phone' and 'rejected' keep their names.

-- New default for freshly scanned / inserted applications.
ALTER TABLE applications ALTER COLUMN stage SET DEFAULT 'applied';
