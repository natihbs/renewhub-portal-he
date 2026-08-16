// Hierarchy-aware target boards for /targets — presentation only.
//
// The management level decides the board, exactly as it does on ManagerHome:
//   center manager   → TEAMS      ("מצב היעדים בצוותים")
//   activity manager → CENTERS    ("מצב היעדים במוקדים"), teams one drill down
//   executive        → ACTIVITIES ("מצב היעדים בפעילויות"), centers then teams
// All three read the SAME scope-home derivations the dashboards use
// (buildScopeTeamRows / buildActivityCenterBoard / buildExecutiveActivityBoard
// / targetReadiness), so the two screens can never disagree about who is
// missing a target. Nothing here derives a number of its own, and no
// percentage is shown for target readiness: a set of teams may mix KPI
// profiles, and a combined "% of target" across מיועדות and יעד would be a
// fabricated unit.
import { useState } from "react";
import { Building2, ChevronDown, Network, Target, UsersRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatNum } from "@/lib/format";
import { KPI_PROFILE_BADGE_CLASS, KPI_PROFILE_LABEL } from "@/lib/performance-domain";
import {
  CENTER_NO_TEAMS_MESSAGE,
  SCOPE_DIRECT_ACTIVITY_GROUP_LABEL,
  SCOPE_METRIC_LABELS,
  targetReadiness,
  type ActivityCenterBoard,
  type ActivityCenterSummary,
  type ExecutiveActivityBoard,
  type ExecutiveActivitySummary,
  type ScopeTeamRow,
  type TargetReadiness,
} from "@/lib/scope-home";

export const CENTER_TARGETS_BOARD_TITLE = "מצב היעדים בצוותים";
export const ACTIVITY_TARGETS_BOARD_TITLE = "מצב היעדים במוקדים";
export const EXECUTIVE_TARGETS_BOARD_TITLE = "מצב היעדים בפעילויות";
/** An activity with no team anywhere under it has no target readiness to report. */
export const ACTIVITY_NO_TEAMS_TARGETS_MESSAGE = "אין צוותים משויכים לפעילות";
export const MANAGE_TARGETS_CTA = "ניהול יעדים";

/** Readiness chips — counts only, never a cross-profile percentage. */
function ReadinessChips({ readiness }: { readiness: TargetReadiness }) {
  const { teamsMissingTarget, teamCount, repsMissingPersonalTarget } = readiness;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge
        variant={teamsMissingTarget > 0 ? "secondary" : "outline"}
        className={cn(
          teamsMissingTarget > 0
            ? "bg-[color:var(--warning)]/15 text-warning-foreground"
            : "bg-[color:var(--success)]/12 text-success-foreground",
        )}
      >
        {teamsMissingTarget > 0
          ? `${teamsMissingTarget} מתוך ${teamCount} צוותים ללא יעד`
          : `יעד מוגדר לכל ${teamCount} הצוותים`}
      </Badge>
      {repsMissingPersonalTarget > 0 && (
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          {repsMissingPersonalTarget} נציגים ללא יעד אישי
        </Badge>
      )}
      {readiness.kpiProfiles.length > 1 && (
        <Badge variant="outline" className="text-muted-foreground">
          פרופילים מעורבים — נמדדים בנפרד
        </Badge>
      )}
    </div>
  );
}

/**
 * One team's target status. Shows the team's OWN KPI-profile wording for the
 * official target (renewals: מיועדות חודשיות; generic: יעד) and never renders
 * a percentage — a missing target is stated as missing, not as 0%.
 */
export function TeamTargetRow({
  row,
  selected,
  onSelect,
}: {
  row: ScopeTeamRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const labels = SCOPE_METRIC_LABELS[row.kpiProfile];
  const hasTarget = row.target !== null && row.target > 0;
  return (
    <div
      className={cn(
        "surface-tile relative overflow-hidden p-3",
        "before:absolute before:inset-y-3 before:start-0 before:w-1 before:rounded-e-full",
        hasTarget ? "before:bg-[color:var(--success)]" : "before:bg-[color:var(--warning)]",
        selected && "border-primary/50 bg-primary/5",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{row.name}</span>
            <Badge
              variant="secondary"
              className={cn("shrink-0", KPI_PROFILE_BADGE_CLASS[row.kpiProfile])}
            >
              {KPI_PROFILE_LABEL[row.kpiProfile]}
            </Badge>
            {selected && (
              <Badge variant="outline" className="border-primary/40 text-primary">
                נבחר
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {labels.target}:{" "}
              <span className={cn("num font-semibold", !hasTarget && "text-warning-foreground")}>
                {hasTarget ? formatNum(row.target as number) : "לא הוגדר"}
              </span>
            </span>
            <span>{row.repCount} נציגים</span>
            {row.missingTargets > 0 && (
              <span className="text-primary">{row.missingTargets} ללא יעד אישי</span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant={selected ? "default" : "outline"}
          className="shrink-0"
          onClick={onSelect}
        >
          <Target className="ms-1 h-3.5 w-3.5" />
          {MANAGE_TARGETS_CTA}
        </Button>
      </div>
    </div>
  );
}

/**
 * CENTER manager board: the center IS the scope, so its teams are listed flat
 * — no redundant center wrapper — with the center-wide readiness summary on
 * top.
 */
export function CenterTargetsBoard({
  rows,
  selectedTeamId,
  onSelectTeam,
  isLoading,
}: {
  rows: ScopeTeamRow[];
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  isLoading: boolean;
}) {
  const readiness = targetReadiness(rows);
  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersRound className="h-4 w-4 text-primary" /> {CENTER_TARGETS_BOARD_TITLE}
        </CardTitle>
        {!isLoading && rows.length > 0 && <ReadinessChips readiness={readiness} />}
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            אין צוותים בהיקף הניהול.
          </div>
        ) : (
          rows.map((row) => (
            <TeamTargetRow
              key={row.id}
              row={row}
              selected={selectedTeamId === row.id}
              onSelect={() => onSelectTeam(row.id)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** One center on the activity targets board — expandable to its own teams. */
function CenterTargetsSurface({
  center,
  expanded,
  onToggle,
  selectedTeamId,
  onSelectTeam,
}: {
  center: ActivityCenterSummary;
  expanded: boolean;
  onToggle: () => void;
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
}) {
  const readiness = targetReadiness(center.teams);
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
        <span className="flex flex-wrap items-center gap-2">
          {center.hasTeams ? (
            <>
              <ReadinessChips readiness={readiness} />
              <ChevronDown
                aria-hidden
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
                  expanded && "rotate-180",
                )}
              />
            </>
          ) : (
            /* An empty center has no targets to be ready or missing — it is a
               structural fact, never 0 teams with target / 0%. */
            <Badge variant="outline" className="text-muted-foreground">
              {CENTER_NO_TEAMS_MESSAGE}
            </Badge>
          )}
        </span>
      </button>
      {center.hasTeams && expanded && (
        <div className="space-y-2 p-3">
          {center.teams.map((row) => (
            <TeamTargetRow
              key={row.id}
              row={row}
              selected={selectedTeamId === row.id}
              onSelect={() => onSelectTeam(row.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One ACTIVITY on the executive targets board. Collapsed it states the
 * activity's own target readiness — counts only, never a cross-profile
 * percentage; expanded it reveals the activity's centers, each drilling to its
 * teams. An activity with no centers and no direct teams has no targets to be
 * ready or missing, so it renders the structural empty state rather than
 * "0 מתוך 0 צוותים ללא יעד".
 */
function ExecutiveActivityTargetsSurface({
  activity,
  expanded,
  onToggle,
  expandedCenterId,
  onToggleCenter,
  selectedTeamId,
  onSelectTeam,
}: {
  activity: ExecutiveActivitySummary;
  expanded: boolean;
  onToggle: () => void;
  expandedCenterId: string | null;
  onToggleCenter: (centerId: string) => void;
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
}) {
  const expandable = activity.centerCount > 0 || activity.directRows.length > 0;
  const readiness = targetReadiness([
    ...activity.centers.flatMap((c) => c.teams),
    ...activity.directRows,
  ]);
  return (
    <div className="rounded-xl border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        disabled={!expandable}
        className={cn(
          "flex w-full flex-wrap items-center justify-between gap-2 rounded-xl p-3 text-start",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          expandable && "transition-colors hover:bg-surface-subtle",
          expanded && "rounded-b-none border-b",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Network className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{activity.activityName}</span>
            <span className="block text-xs text-muted-foreground">
              {activity.centerCount} מוקדים · {activity.teamCount} צוותים
            </span>
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {activity.hasTeams ? (
            <>
              <ReadinessChips readiness={readiness} />
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
              {ACTIVITY_NO_TEAMS_TARGETS_MESSAGE}
            </Badge>
          )}
        </span>
      </button>
      {expandable && expanded && (
        <div className="space-y-2 p-3">
          {activity.centers.map((center) => (
            <CenterTargetsSurface
              key={center.centerId}
              center={center}
              expanded={expandedCenterId === center.centerId}
              onToggle={() => onToggleCenter(center.centerId)}
              selectedTeamId={selectedTeamId}
              onSelectTeam={onSelectTeam}
            />
          ))}
          {activity.directRows.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-semibold">{SCOPE_DIRECT_ACTIVITY_GROUP_LABEL}</div>
              {activity.directRows.map((row) => (
                <TeamTargetRow
                  key={row.id}
                  row={row}
                  selected={selectedTeamId === row.id}
                  onSelect={() => onSelectTeam(row.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * EXECUTIVE board: the target status of the business as it is BUILT —
 * ACTIVITIES first, then their centers, then teams, then (in the workspace
 * panel below) the representatives of the selected team. Empty activities and
 * empty centers stay on the board, covered teams outside every activity
 * subtree keep their honest group, and a missing target is always stated as
 * "לא הוגדר" rather than counted as a zero.
 */
export function ExecutiveTargetsBoard({
  board,
  selectedTeamId,
  onSelectTeam,
  isLoading,
  unattachedLabel,
  emptyMessage,
}: {
  board: ExecutiveActivityBoard;
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  isLoading: boolean;
  unattachedLabel: string;
  emptyMessage: string;
}) {
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const [expandedCenterId, setExpandedCenterId] = useState<string | null>(null);
  const empty = board.activities.length === 0 && board.unattachedRows.length === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="h-4 w-4 text-primary" /> {EXECUTIVE_TARGETS_BOARD_TITLE}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : empty ? (
          <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <>
            {board.activities.map((activity) => (
              <ExecutiveActivityTargetsSurface
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
                selectedTeamId={selectedTeamId}
                onSelectTeam={onSelectTeam}
              />
            ))}
            {board.unattachedRows.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">{unattachedLabel}</div>
                {board.unattachedRows.map((row) => (
                  <TeamTargetRow
                    key={row.id}
                    row={row}
                    selected={selectedTeamId === row.id}
                    onSelect={() => onSelectTeam(row.id)}
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
 * ACTIVITY manager board: one surface per center UNIT of the activity —
 * including empty centers — with the manager's own covered teams one drill
 * level down. Teams attached straight to the activity, or covered but outside
 * the hierarchy subtree, keep their honest labeled groups so nothing in scope
 * disappears. Center population comes from buildActivityCenterBoard, which is
 * already filtered to `parentId === scope.unitId` (PR #53).
 */
export function ActivityTargetsBoard({
  board,
  selectedTeamId,
  onSelectTeam,
  isLoading,
  directLabel,
  unattachedLabel,
}: {
  board: ActivityCenterBoard;
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  isLoading: boolean;
  directLabel: string;
  unattachedLabel: string;
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
          <Building2 className="h-4 w-4 text-primary" /> {ACTIVITY_TARGETS_BOARD_TITLE}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : empty ? (
          <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            אין מוקדים משויכים לפעילות.
          </div>
        ) : (
          <>
            {board.centers.map((center) => (
              <CenterTargetsSurface
                key={center.centerId}
                center={center}
                expanded={expandedCenterId === center.centerId}
                onToggle={() =>
                  setExpandedCenterId((cur) => (cur === center.centerId ? null : center.centerId))
                }
                selectedTeamId={selectedTeamId}
                onSelectTeam={onSelectTeam}
              />
            ))}
            {board.directRows.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">{directLabel}</div>
                {board.directRows.map((row) => (
                  <TeamTargetRow
                    key={row.id}
                    row={row}
                    selected={selectedTeamId === row.id}
                    onSelect={() => onSelectTeam(row.id)}
                  />
                ))}
              </div>
            )}
            {board.unattachedRows.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">{unattachedLabel}</div>
                {board.unattachedRows.map((row) => (
                  <TeamTargetRow
                    key={row.id}
                    row={row}
                    selected={selectedTeamId === row.id}
                    onSelect={() => onSelectTeam(row.id)}
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
