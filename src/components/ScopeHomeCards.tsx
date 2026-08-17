// Scope-level home cards for business-scope managers (מנהל מוקד / מנהל
// פעילות / סמנכ"ל). All derivations live in scope-home.ts (pure, tested);
// this file only renders the groups, per-profile aggregates and the missing-
// targets-by-team breakdown. Direct team managers never see these cards —
// their home is the unchanged single-team layout.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Building2, ChevronDown, Network, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatNum, formatPct } from "@/lib/format";
import { KPI_PROFILE_BADGE_CLASS, KPI_PROFILE_LABEL } from "@/lib/performance-domain";
import {
  ACTIVITY_CENTERS_TITLE,
  ACTIVITY_NO_CENTERS_MESSAGE,
  CENTER_NO_TEAMS_MESSAGE,
  EXECUTIVE_ACTIVITIES_TITLE,
  EXECUTIVE_NO_ACTIVITIES_MESSAGE,
  SCOPE_DIRECT_ACTIVITY_GROUP_LABEL,
  SCOPE_METRIC_LABELS,
  SCOPE_MISSING_TARGETS_TITLE,
  SCOPE_NO_TEAMS_MESSAGE,
  SCOPE_TEAMS_TITLE,
  SCOPE_UNATTACHED_GROUP_LABEL,
  type ActivityCenterBoard,
  type ActivityCenterSummary,
  type ExecutiveActivityBoard,
  type ExecutiveActivitySummary,
  type MissingTargetsRow,
  type ScopeGroup,
  type ScopeProfileAggregate,
  type ScopeTeamRow,
} from "@/lib/scope-home";

function ScopeCardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">טוען נתונים…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

function ScopeErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
      {message}
    </div>
  );
}

/** One team row, labeled by the team's OWN KPI profile. */
function ScopeTeamRowView({ row, onSelect }: { row: ScopeTeamRow; onSelect?: () => void }) {
  const labels = SCOPE_METRIC_LABELS[row.kpiProfile];
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{row.name}</span>
          <Badge
            variant="secondary"
            className={cn("shrink-0", KPI_PROFILE_BADGE_CLASS[row.kpiProfile])}
          >
            {KPI_PROFILE_LABEL[row.kpiProfile]}
          </Badge>
          <Badge variant="outline" className="shrink-0">
            {row.repCount} נציגים
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {row.missingTargets > 0 && (
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              {row.missingTargets} ללא יעד
            </Badge>
          )}
          {onSelect && (
            <Button size="sm" variant="ghost" className="h-7" onClick={onSelect}>
              פירוט
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <div className="text-muted-foreground">{labels.target}</div>
          <div className="num font-bold">{row.target == null ? "—" : formatNum(row.target)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">{labels.result}</div>
          <div className="num font-bold">{formatNum(row.completed)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">{labels.rate}</div>
          <div className="num font-bold">{row.pct == null ? "לא זמין" : formatPct(row.pct)}</div>
        </div>
      </div>
      {row.pct != null && <Progress value={Math.min(row.pct, 150)} className="mt-2 h-1.5" />}
    </div>
  );
}

/** Per-profile aggregate chips — renewals and generic sales stay separate. */
function ProfileAggregates({ aggregates }: { aggregates: ScopeProfileAggregate[] }) {
  if (aggregates.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {aggregates.map((agg) => {
        const labels = SCOPE_METRIC_LABELS[agg.kpiProfile];
        return (
          <div key={agg.kpiProfile} className="rounded-lg border bg-muted/30 p-3 text-xs">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="font-semibold">
                {KPI_PROFILE_LABEL[agg.kpiProfile]} · {agg.teamCount} צוותים
              </span>
              {agg.teamsWithTarget < agg.teamCount && (
                <span className="text-muted-foreground">
                  יעד מוגדר ל-{agg.teamsWithTarget} מתוך {agg.teamCount}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-muted-foreground">{labels.target}</div>
                <div className="num font-bold">{agg.target == null ? "—" : formatNum(agg.target)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{labels.result}</div>
                <div className="num font-bold">{formatNum(agg.completed)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{labels.rate}</div>
                <div className="num font-bold">{agg.pct == null ? "לא זמין" : formatPct(agg.pct)}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One center summary surface on the activity manager's board. A center with
 * teams is an expandable drill-down (header button → its teams only); a
 * center without teams renders the honest structural empty state — no
 * numbers, no percentage, no invented action.
 */
function ActivityCenterSurface({
  center,
  expanded,
  onToggle,
  onSelectTeam,
}: {
  center: ActivityCenterSummary;
  expanded: boolean;
  onToggle: () => void;
  onSelectTeam?: (teamId: string) => void;
}) {
  return (
    <div className="rounded-xl border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        disabled={!center.hasTeams}
        className={cn(
          "flex w-full flex-wrap items-center justify-between gap-2 rounded-xl p-3 text-start",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          center.hasTeams && "transition-colors hover:bg-surface-subtle",
          expanded && "rounded-b-none border-b",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </span>
          <span className="min-w-0 truncate font-semibold">{center.centerName}</span>
        </span>
        <span className="flex items-center gap-2">
          {center.hasTeams ? (
            <>
              <Badge variant="outline">{center.teamCount} צוותים</Badge>
              <Badge variant="outline">{center.repCount} נציגים</Badge>
              {center.missingRepresentativeTargets > 0 && (
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  {center.missingRepresentativeTargets} ללא יעד
                </Badge>
              )}
              <ChevronDown
                aria-hidden
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
                  expanded && "rotate-180",
                )}
              />
            </>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {CENTER_NO_TEAMS_MESSAGE}
            </Badge>
          )}
        </span>
      </button>
      {center.hasTeams && (
        <div className="space-y-2 p-3 pt-2">
          {/* Per-profile summary is always visible; the team rows are the
              drill-down layer behind the expand. */}
          <ProfileAggregates aggregates={center.profileAggregates} />
          {expanded &&
            center.teams.map((row) => (
              <ScopeTeamRowView
                key={row.id}
                row={row}
                onSelect={onSelectTeam ? () => onSelectTeam(row.id) : undefined}
              />
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * The activity manager's PRIMARY board — one surface per center UNIT of the
 * activity (empty centers included), plus honest groups for teams attached
 * straight to the activity or outside the hierarchy. The manager manages
 * CENTERS; teams appear only inside the center they belong to, one drill
 * level down.
 */
export function ActivityCenterBoardCard({
  board,
  isLoading,
  isError,
  onSelectTeam,
}: {
  board: ActivityCenterBoard;
  isLoading: boolean;
  isError: boolean;
  onSelectTeam?: (teamId: string) => void;
}) {
  const [expandedCenterId, setExpandedCenterId] = useState<string | null>(null);
  const empty =
    board.centers.length === 0 &&
    board.directRows.length === 0 &&
    board.unattachedRows.length === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" /> {ACTIVITY_CENTERS_TITLE}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <ScopeCardSkeleton />
        ) : isError ? (
          <ScopeErrorState message="לא ניתן לטעון את נתוני ההיקף." />
        ) : empty ? (
          <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            {ACTIVITY_NO_CENTERS_MESSAGE}
          </div>
        ) : (
          <>
            {board.centers.map((center) => (
              <ActivityCenterSurface
                key={center.centerId}
                center={center}
                expanded={expandedCenterId === center.centerId}
                onToggle={() =>
                  setExpandedCenterId((cur) => (cur === center.centerId ? null : center.centerId))
                }
                onSelectTeam={onSelectTeam}
              />
            ))}
            {board.directRows.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">{SCOPE_DIRECT_ACTIVITY_GROUP_LABEL}</div>
                {board.directRows.map((row) => (
                  <ScopeTeamRowView
                    key={row.id}
                    row={row}
                    onSelect={onSelectTeam ? () => onSelectTeam(row.id) : undefined}
                  />
                ))}
              </div>
            )}
            {board.unattachedRows.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">{SCOPE_UNATTACHED_GROUP_LABEL}</div>
                {board.unattachedRows.map((row) => (
                  <ScopeTeamRowView
                    key={row.id}
                    row={row}
                    onSelect={onSelectTeam ? () => onSelectTeam(row.id) : undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One ACTIVITY surface on the executive's board — the level they manage from.
 * Collapsed it states how the activity is BUILT (centers / teams / active
 * representatives) plus its per-profile performance; expanded it reveals the
 * activity's own centers, each of which drills to its teams. An activity with
 * nothing under it renders the structural empty state and stays on the board:
 * an empty activity is a real fact about the business, never a poor performer.
 */
function ExecutiveActivitySurface({
  activity,
  expanded,
  onToggle,
  expandedCenterId,
  onToggleCenter,
  onSelectTeam,
}: {
  activity: ExecutiveActivitySummary;
  expanded: boolean;
  onToggle: () => void;
  expandedCenterId: string | null;
  onToggleCenter: (centerId: string) => void;
  onSelectTeam?: (teamId: string) => void;
}) {
  const expandable = activity.centerCount > 0 || activity.directRows.length > 0;
  return (
    <div className="surface-tile overflow-hidden p-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        disabled={!expandable}
        className={cn(
          "flex w-full flex-wrap items-center justify-between gap-2 p-3 text-start",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          expandable && "transition-colors hover:bg-surface-subtle",
          expanded && "border-b",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Network className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{activity.activityName}</span>
            <span className="block text-xs text-muted-foreground">
              {activity.centerCount} מוקדים · {activity.teamCount} צוותים · {activity.repCount}{" "}
              נציגים
            </span>
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {activity.centersWithoutTeams > 0 && (
            <Badge
              variant="secondary"
              className="bg-[color:var(--warning)]/15 text-warning-foreground"
            >
              {activity.centersWithoutTeams} מוקדים ללא צוותים
            </Badge>
          )}
          {activity.missingRepresentativeTargets > 0 && (
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              {activity.missingRepresentativeTargets} ללא יעד
            </Badge>
          )}
          {expandable ? (
            <ChevronDown
              aria-hidden
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
                expanded && "rotate-180",
              )}
            />
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {ACTIVITY_NO_CENTERS_MESSAGE}
            </Badge>
          )}
        </span>
      </button>
      {/* The body renders only when it actually HAS content. An activity that
          holds centers but no teams anywhere is expandable and, while
          collapsed, has nothing to show — rendering the padded container for
          it left an unexplained gap under the header that reads as a broken
          card. The activity itself, and its empty centers, stay fully visible:
          the header keeps its counts and the drill-down still opens. */}
      {expandable && (activity.hasTeams || expanded) && (
        <div className="space-y-2 p-3">
          {/* Per-profile performance is always visible for an activity that
              has teams; the centers are the drill-down layer behind it. */}
          {activity.hasTeams && <ProfileAggregates aggregates={activity.profileAggregates} />}
          {expanded && (
            <>
              {activity.centers.map((center) => (
                <ActivityCenterSurface
                  key={center.centerId}
                  center={center}
                  expanded={expandedCenterId === center.centerId}
                  onToggle={() => onToggleCenter(center.centerId)}
                  onSelectTeam={onSelectTeam}
                />
              ))}
              {activity.directRows.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold">{SCOPE_DIRECT_ACTIVITY_GROUP_LABEL}</div>
                  {activity.directRows.map((row) => (
                    <ScopeTeamRowView
                      key={row.id}
                      row={row}
                      onSelect={onSelectTeam ? () => onSelectTeam(row.id) : undefined}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The EXECUTIVE's primary board — one surface per ACTIVITY of the business,
 * empty activities included, drilling ACTIVITY → CENTERS → TEAMS (and from a
 * team into its representatives, via the selected-team panel). There is no
 * board-level percentage and no board-level target: activities mix KPI
 * profiles, and no honest single number spans them.
 */
export function ExecutiveActivityBoardCard({
  board,
  isLoading,
  isError,
  onSelectTeam,
}: {
  board: ExecutiveActivityBoard;
  isLoading: boolean;
  isError: boolean;
  onSelectTeam?: (teamId: string) => void;
}) {
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const [expandedCenterId, setExpandedCenterId] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="h-4 w-4 text-primary" /> {EXECUTIVE_ACTIVITIES_TITLE}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <ScopeCardSkeleton />
        ) : isError ? (
          <ScopeErrorState message="לא ניתן לטעון את נתוני ההיקף." />
        ) : board.activities.length === 0 && board.unattachedRows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            {EXECUTIVE_NO_ACTIVITIES_MESSAGE}
          </div>
        ) : (
          <>
            {board.activities.map((activity) => (
              <ExecutiveActivitySurface
                key={activity.activityId}
                activity={activity}
                expanded={expandedActivityId === activity.activityId}
                onToggle={() =>
                  setExpandedActivityId((cur) =>
                    cur === activity.activityId ? null : activity.activityId,
                  )
                }
                expandedCenterId={expandedCenterId}
                onToggleCenter={(centerId) =>
                  setExpandedCenterId((cur) => (cur === centerId ? null : centerId))
                }
                onSelectTeam={onSelectTeam}
              />
            ))}
            {board.activities.length === 0 && (
              <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
                {EXECUTIVE_NO_ACTIVITIES_MESSAGE}
              </div>
            )}
            {board.unattachedRows.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">{SCOPE_UNATTACHED_GROUP_LABEL}</div>
                {board.unattachedRows.map((row) => (
                  <ScopeTeamRowView
                    key={row.id}
                    row={row}
                    onSelect={onSelectTeam ? () => onSelectTeam(row.id) : undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The scope's primary card: per-profile aggregates on top, then team rows in
 * the hierarchy grouping of the manager's level (flat for a center; by center
 * for an activity; activity → centers for an executive).
 */
export function ScopeOverviewCard({
  groups,
  aggregates,
  isLoading,
  isError,
  onSelectTeam,
  title = SCOPE_TEAMS_TITLE,
}: {
  groups: ScopeGroup[];
  aggregates: ScopeProfileAggregate[];
  isLoading: boolean;
  isError: boolean;
  onSelectTeam?: (teamId: string) => void;
  /** Level-specific board title (a center manager's board says "מצב הצוותים"). */
  title?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <ScopeCardSkeleton />
        ) : isError ? (
          <ScopeErrorState message="לא ניתן לטעון את נתוני ההיקף." />
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            {SCOPE_NO_TEAMS_MESSAGE}
          </div>
        ) : (
          <>
            <ProfileAggregates aggregates={aggregates} />
            {groups.map((group) => (
              <div key={group.key} className="space-y-2">
                {group.label && <div className="text-sm font-semibold">{group.label}</div>}
                {group.rows.map((row) => (
                  <ScopeTeamRowView
                    key={row.id}
                    row={row}
                    onSelect={onSelectTeam ? () => onSelectTeam(row.id) : undefined}
                  />
                ))}
                {(group.subgroups ?? []).map((sub) => (
                  <div key={sub.key} className="space-y-2 ps-3">
                    <div className="text-sm font-medium text-muted-foreground">{sub.label}</div>
                    {sub.rows.map((row) => (
                      <ScopeTeamRowView
                        key={row.id}
                        row={row}
                        onSelect={onSelectTeam ? () => onSelectTeam(row.id) : undefined}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Missing representative targets grouped BY TEAM — "חידושי רכב · 9 נציגים
 * ללא יעד" tells the manager where to act; an org-wide count does not.
 */
export function ScopeMissingTargetsCard({
  rows,
  isLoading,
  isError,
}: {
  rows: MissingTargetsRow[];
  isLoading: boolean;
  isError: boolean;
}) {
  const anyMissing = rows.some((r) => r.missing > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" /> {SCOPE_MISSING_TARGETS_TITLE}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <ScopeCardSkeleton rows={2} />
        ) : isError ? (
          <ScopeErrorState message="לא ניתן לטעון את נתוני היעדים." />
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            {SCOPE_NO_TEAMS_MESSAGE}
          </div>
        ) : (
          <>
            {rows.map((row) => (
              <div
                key={row.teamId}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm",
                  row.missing > 0 && "border-primary/40 bg-primary/5",
                )}
              >
                <span>{row.line}</span>
                <span className="text-xs text-muted-foreground">מתוך {row.repCount} נציגים</span>
              </div>
            ))}
            {anyMissing && (
              <Button asChild size="sm" variant="outline">
                <Link to="/targets">
                  <Target className="ms-1 h-3.5 w-3.5" />
                  להגדרת יעדים
                </Link>
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
