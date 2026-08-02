-- morning_settings.yesterday_renewal_pct / monthly_avg_renewal_pct name the universal
-- target-achievement metric as if it were a renewal rate, and nothing in the app has
-- ever written a value into them (they've always read back as their default of 0).
-- Add generic, correctly-named replacements additively; keep the legacy columns
-- (nullable-safe, still defaulted) for backward compatibility with anything external
-- that might read them, and mark them deprecated. Do not rename or drop them here.
ALTER TABLE public.morning_settings
  ADD COLUMN IF NOT EXISTS yesterday_achievement_pct numeric NOT NULL DEFAULT 0;

ALTER TABLE public.morning_settings
  ADD COLUMN IF NOT EXISTS monthly_avg_achievement_pct numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.morning_settings.yesterday_renewal_pct IS
  'Deprecated: mislabeled as a renewal rate but always held plain target achievement. Replaced by yesterday_achievement_pct. No longer read or written by the application.';

COMMENT ON COLUMN public.morning_settings.monthly_avg_renewal_pct IS
  'Deprecated: mislabeled as a renewal rate but always held plain target achievement. Replaced by monthly_avg_achievement_pct. No longer read or written by the application.';
