-- Dashboard Operational Hardening (P0): real achievement history
--
-- PROBLEM. Morning Routine showed a day-over-day trend badge computed as:
--     change = achievementPct - morning.yesterdayAchievementPct
-- where yesterdayAchievementPct read morning_settings.yesterday_achievement_pct.
--
-- NOTHING IN THE CODEBASE EVER WROTE THAT COLUMN. It was added NOT NULL
-- DEFAULT 0 and left at 0 forever, with a `?? 0` on the read side turning
-- "never populated" into a plausible-looking zero. So a team at 87% displayed
-- a green upward badge reading "+87.0%" and the line "מול 0% אתמול ·
-- ממוצע חודשי 0%" — every morning, on the worst day of the quarter as
-- readily as the best. The single directional signal on the manager's morning
-- card always pointed up, by the full magnitude of the metric.
--
-- WHY A SNAPSHOT TABLE. Achievement is
--     SUM(representatives.current_result) / team_goals.target_value
-- and current_result is a scalar with no history — there is no dated series
-- anywhere in this schema from which yesterday's team achievement can be
-- reconstructed after the fact. kpi_values IS dated, but it drives renewals
-- only, and deriving the trend from a different source than the headline
-- figure would reintroduce exactly the kind of drift this program has been
-- removing.
--
-- So the honest options were: record the real series going forward, or delete
-- the comparison. This does the first, and the UI does the second until the
-- series exists — a team with no prior snapshot reports "אין השוואה" rather
-- than a fabricated baseline. Missing history stays missing.
--
-- One row per team per day, holding the figures AS DISPLAYED that day, so a
-- later target change cannot retroactively rewrite what yesterday looked like.

CREATE TABLE IF NOT EXISTS public.team_achievement_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT current_date,
  -- The three figures are stored together, not just the percentage, so a
  -- reviewer can always tell whether a change came from the result moving or
  -- from the target being edited.
  result_value integer NOT NULL,
  target_value integer,
  achievement_pct numeric,
  representative_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS team_achievement_snapshots_team_date_idx
  ON public.team_achievement_snapshots (team_id, snapshot_date DESC);

GRANT SELECT ON public.team_achievement_snapshots TO authenticated;
GRANT ALL ON public.team_achievement_snapshots TO service_role;
ALTER TABLE public.team_achievement_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER team_achievement_snapshots_updated BEFORE UPDATE ON public.team_achievement_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Read follows team management: a manager sees their own teams' history, an
-- admin sees all. No client write policy — snapshots are written exclusively
-- by recordTeamAchievementSnapshot under service_role, so a manager cannot
-- manufacture a flattering baseline for their own team.
CREATE POLICY "team_achievement_snapshots read" ON public.team_achievement_snapshots
FOR SELECT TO authenticated
USING (private.is_admin(auth.uid()) OR private.manages_team(team_id));

COMMENT ON TABLE public.team_achievement_snapshots IS
  'Dated record of a team''s achievement as displayed on a given day. Written once per team per day by recordTeamAchievementSnapshot (src/lib/dashboard.functions.ts) under service_role; never writable by a client. Exists because achievement is derived from representatives.current_result, a scalar with no history — without this table there is no truthful way to answer "how does today compare to yesterday", which is why the previous trend badge compared against a column nothing ever wrote.';

-- ---------- upsert ----------
--
-- Idempotent per team per day: opening the dashboard five times updates the
-- same row rather than creating five. The row always holds the LATEST figures
-- seen that day, which is what "where the team ended up" means for a
-- comparison made tomorrow.
DROP FUNCTION IF EXISTS public.record_team_achievement_snapshot(uuid, date, integer, integer, numeric, integer);
CREATE FUNCTION public.record_team_achievement_snapshot(
  _team_id uuid,
  _snapshot_date date,
  _result_value integer,
  _target_value integer,
  _achievement_pct numeric,
  _representative_count integer
)
RETURNS TABLE (out_snapshot_id uuid, out_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_created boolean := false;
BEGIN
  SELECT s.id INTO v_id
  FROM public.team_achievement_snapshots s
  WHERE s.team_id = _team_id AND s.snapshot_date = _snapshot_date
  FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO public.team_achievement_snapshots
      (team_id, snapshot_date, result_value, target_value, achievement_pct, representative_count)
    VALUES
      (_team_id, _snapshot_date, _result_value, _target_value, _achievement_pct, _representative_count)
    RETURNING id INTO v_id;
    v_created := true;
  ELSE
    UPDATE public.team_achievement_snapshots
    SET result_value = _result_value,
        target_value = _target_value,
        achievement_pct = _achievement_pct,
        representative_count = _representative_count
    WHERE id = v_id;
  END IF;

  RETURN QUERY SELECT v_id, v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.record_team_achievement_snapshot(uuid, date, integer, integer, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_team_achievement_snapshot(uuid, date, integer, integer, numeric, integer) TO service_role;

COMMENT ON FUNCTION public.record_team_achievement_snapshot(uuid, date, integer, integer, numeric, integer) IS
  'Idempotently records (or refreshes) one team''s achievement snapshot for one date, under a row lock. Callable only by service_role — the calling server function authorizes the manager against the team first.';

-- ---------- retire the columns that were never written ----------
--
-- Left in place rather than dropped (an unread column is harmless; a dropped
-- one breaks any external reader), but documented so nobody wires a UI to
-- them again. The application no longer reads either.
COMMENT ON COLUMN public.morning_settings.yesterday_achievement_pct IS
  'DEAD. Never written by any code path since it was introduced; the read side''s "?? 0" turned that into a permanent, plausible-looking zero, which is what made the trend badge always read "+<full achievement>". Superseded by public.team_achievement_snapshots. Do not read this column.';

COMMENT ON COLUMN public.morning_settings.monthly_avg_achievement_pct IS
  'DEAD. Never written by any code path. Superseded by public.team_achievement_snapshots, from which a monthly average is computed over real dated rows. Do not read this column.';
