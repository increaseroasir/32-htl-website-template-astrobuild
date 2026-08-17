-- 0003 — vault write-status on the durable record (Lead Vault, Job 2).
--
-- A failed SHEET append cannot record itself in the sheet, and "nothing
-- may vanish into a console.error" — so the outcome of every vault write
-- lands HERE, on the D1 row, where the retry job (later ticket) can find
-- it. Values: '' (pre-vault rows), 'SENT', 'FAILED', 'DRIFTED',
-- 'UNCONFIGURED'.
ALTER TABLE leads ADD COLUMN vault_status TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN vault_error TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN vault_synced_at INTEGER;
