-- 0004 — cross-session duplicate detection (Lead Vault, Job 3).
--
-- conversion_status is the per-lead record of what happened to the Lead
-- conversion: 'PENDING' at insert, then 'SENT' / 'FAILED' / 'DUPLICATE'
-- / 'DISABLED' before the response. ('' = rows from before this
-- migration.) The duplicate decision reads the PRIOR lead's value:
-- FAILED lets the new submission fire (a retry that recovers lost
-- signal); everything else suppresses it (the signal was already
-- counted, is in flight, or was itself deliberately suppressed — firing
-- again teaches Meta to find the same person twice).
ALTER TABLE leads ADD COLUMN conversion_status TEXT NOT NULL DEFAULT '';

-- The check is ONE INDEXED QUERY, never a sheet read (Sun Pool read the
-- entire sheet on every submission — slower forever, and a Google call
-- on the critical path). leads.phone is stored digits-only, so
-- substr(phone, -10) IS the phone normalisation at query time; SQLite
-- only uses the expression index when the query repeats that exact
-- expression, so keep src/lib/duplicates.ts and this index in lockstep.
CREATE INDEX IF NOT EXISTS idx_leads_dup_email ON leads (email, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_dup_phone ON leads (substr(phone, -10), created_at);
