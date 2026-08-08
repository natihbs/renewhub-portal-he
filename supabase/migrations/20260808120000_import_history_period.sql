-- Import hardening: record the reporting period an import applied to.
-- Additive and idempotent — no data is modified or removed.
ALTER TABLE public.import_history ADD COLUMN IF NOT EXISTS period text;

COMMENT ON COLUMN public.import_history.period IS
  'Reporting period ("YYYY-MM") the applied rows agreed on; null when the file mixed months or carried no dates.';
