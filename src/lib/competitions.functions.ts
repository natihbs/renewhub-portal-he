// Competition server functions.
//
// WHY THIS EXISTS: competition_scores is readable to every authenticated user
// ("comp scores read" — a competition is a shared, public-by-design surface),
// but representatives rows are deliberately NOT: a representative's RLS gives
// them exactly their own row. The leaderboard UI used to resolve names from
// the client-side representatives mirror, so a representative saw a board
// where every other competitor was nameless — a four-person competition
// rendered as one person.
//
// The fix is a NARROW projection, not a wider policy: this function returns,
// for one competition, only { representativeId, displayName, total, rank } —
// the exact fields a leaderboard needs. Names are resolved server-side ONLY
// for representatives who actually hold a score row in the requested
// competition, so it cannot be used to browse the representatives table, and
// it exposes no team assignment, external_ref, user_id, performance or any
// other representative data. The representatives SELECT RLS is unchanged.
//
// Scoring semantics are the canonical ones: competitionStandings
// (home-domain.ts) — the same "points × count summed over categories" with
// tied-rank handling that the home cards and the manager page already use, so
// this projection can never disagree with them.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import { competitionStandings } from "@/lib/home-domain";

type Ctx = { supabase: SupabaseClient; userId: string; claims: Record<string, unknown> | null };

export type CompetitionStandingEntry = {
  representativeId: string;
  displayName: string;
  total: number;
  rank: number;
};

/** A participant whose representative row has since vanished stays on the
 * board with an honest placeholder rather than being dropped. */
export const UNKNOWN_COMPETITOR_LABEL = "נציג לא זמין";

export const getCompetitionStandings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { competition_id: string }) => {
    const id = String(data?.competition_id ?? "").trim();
    if (!id) throw new Error("מזהה תחרות חסר");
    return { competition_id: id };
  })
  .handler(async ({ data, context }): Promise<CompetitionStandingEntry[]> => {
    const ctx = context as unknown as Ctx;

    // Everything about the COMPETITION is read through the caller's own
    // client — competitions, categories and scores are all
    // authenticated-readable, so RLS remains the decision-maker and this
    // read also proves the competition is visible to the caller at all.
    const [compRes, catRes, scoreRes] = await Promise.all([
      ctx.supabase.from("competitions").select("id").eq("id", data.competition_id).maybeSingle(),
      ctx.supabase
        .from("competition_categories")
        .select("id, points")
        .eq("competition_id", data.competition_id),
      ctx.supabase
        .from("competition_scores")
        .select("representative_id, category_id, count")
        .eq("competition_id", data.competition_id),
    ]);
    if (compRes.error) throw new Error(compRes.error.message);
    if (!compRes.data) throw new Error("התחרות לא נמצאה");
    if (catRes.error) throw new Error(catRes.error.message);
    if (scoreRes.error) throw new Error(scoreRes.error.message);

    const standings = competitionStandings({
      categories: ((catRes.data ?? []) as { id: string; points: number }[]).map((c) => ({
        id: c.id,
        points: c.points,
      })),
      scores: (
        (scoreRes.data ?? []) as {
          representative_id: string;
          category_id: string;
          count: number;
        }[]
      ).map((s) => ({ repId: s.representative_id, categoryId: s.category_id, count: s.count })),
    });
    if (standings.length === 0) return [];

    // Names — the ONLY thing the admin client is used for, and only for the
    // ids that already appear in this competition's standings. This is a
    // display projection, never a directory: no other column leaves here.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: repRows, error: repErr } = await supabaseAdmin
      .from("representatives")
      .select("id, name")
      .in(
        "id",
        standings.map((s) => s.repId),
      );
    if (repErr) throw new Error(repErr.message);
    const nameById = new Map(
      ((repRows ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
    );

    return standings.map((s) => ({
      representativeId: s.repId,
      displayName: nameById.get(s.repId) ?? UNKNOWN_COMPETITOR_LABEL,
      total: s.total,
      rank: s.rank,
    }));
  });
