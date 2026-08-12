-- 0002 — the TCPA consent record (D-04, paid-ads spec §1.8).
--
-- Which consent text (by version), seen at which URL, agreed to when.
-- created_at/updated_at on the row already carry the "when"; ip_address
-- and user_agent already carry the "who from where" (0001 baseline).
ALTER TABLE leads ADD COLUMN consent_version TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN consent_text TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN consent_url TEXT NOT NULL DEFAULT '';
