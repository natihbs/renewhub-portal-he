import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useApp, competitionLeaderboard, useIsManager } from "@/lib/store";
import type { Competition } from "@/lib/seed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Trophy, Plus, Pencil, Trash2, Medal, X, MoreVertical, Archive, ArchiveRestore, RotateCcw } from "lucide-react";
import { formatDateIL, formatNum } from "@/lib/format";
import { toast } from "sonner";
import { ManagerOnly } from "@/components/ManagerOnly";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/competitions")({
  head: () => ({
    meta: [
      { title: "תחרויות · Pulse" },
      { name: "description", content: "תחרויות פעילות, ניקוד וטבלת מובילים" },
      { property: "og:title", content: "תחרויות · Pulse" },
      { property: "og:description", content: "תחרויות פעילות, ניקוד וטבלת מובילים" },
    ],
  }),
  component: CompetitionsPage,
});

/**
 * A competition may only be hard-deleted while it has no recorded scores
 * (count > 0 for any category). Once real achievement is on the board it
 * becomes part of representatives' history — deletion is permanently
 * disabled and Archive is offered instead (see CompetitionActionsMenu).
 */
export function hasRecordedScores(comp: Competition) {
  return comp.scores.some((s) => s.count > 0);
}

/**
 * Plain "DD.MM.YYYY – DD.MM.YYYY" text inside an RTL page reorders visually
 * (digits form an LTR run, but paragraph-level bidi still flips run order),
 * showing the end date before the start date. Isolating it as its own LTR
 * run keeps the logical (and correct) start→end order on screen.
 */
function CompetitionDateRange({ start, end, className }: { start: string; end: string; className?: string }) {
  return (
    <span dir="ltr" className={className}>
      {formatDateIL(start)} — {formatDateIL(end)}
    </span>
  );
}

function CompetitionStatusBadge({ comp }: { comp: Competition }) {
  if (comp.active) return <Badge className="border-0 bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/20">פעילה</Badge>;

  if (comp.archived) return <Badge variant="secondary">בארכיון</Badge>;
  return <Badge variant="outline">הסתיימה</Badge>;
}

function Leaderboard({ comp, nameOf }: { comp: Competition; nameOf: (id: string) => string }) {
  const leaderboard = useMemo(() => competitionLeaderboard(comp), [comp]);
  if (leaderboard.length === 0) return <EmptyState icon={Medal} title="אין ניקוד עדיין" compact />;
  return (
    <div className="space-y-2">
      {leaderboard.map((row, i) => (
        <div key={row.repId} className="flex items-center gap-3 rounded-xl border p-3">
          <MedalIcon place={i + 1} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{nameOf(row.repId)}</div>
            <div className="text-xs text-muted-foreground">מקום {i + 1}</div>
          </div>
          <div className="text-lg font-extrabold text-primary">{formatNum(row.total)}</div>
        </div>
      ))}
    </div>
  );
}

function CompetitionsPage() {
  const { state, closeCompetition } = useApp();
  const isManager = useIsManager();
  const active = state.competitions.filter((c) => c.active);
  const completed = state.competitions.filter((c) => !c.active && !c.archived);
  const archived = state.competitions.filter((c) => !c.active && c.archived);

  const [detailsId, setDetailsId] = useState<string | null>(null);
  const detailsComp = state.competitions.find((c) => c.id === detailsId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="תחרויות"
        description="מעקב תחרויות פעילות, ניקוד וטבלאות מובילים"
        actions={
          <ManagerOnly>
            <CompetitionFormDialog trigger={<Button><Plus className="ms-1 h-4 w-4" />יצירת תחרות</Button>} />
          </ManagerOnly>
        }
      />

      {active.length === 0 && completed.length === 0 && archived.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Trophy}
              title="עדיין אין תחרויות"
              description="צרו תחרות ראשונה כדי לעודד את הצוות, להגדיר קטגוריות ניקוד ולהציג טבלת מובילים בזמן אמת."
              action={
                <ManagerOnly>
                  <CompetitionFormDialog trigger={<Button><Plus className="ms-1 h-4 w-4" />יצירת תחרות</Button>} />
                </ManagerOnly>
              }
            />
          </CardContent>
        </Card>
      )}

      {active.map((c) => (
        <ActiveCompetitionCard key={c.id} comp={c} onClose={() => closeCompetition(c.id)} isManager={isManager} />
      ))}

      {completed.length > 0 && (
        <div>
          <h2 className="text-lg font-bold mb-3">תחרויות שהסתיימו</h2>
          <div className="space-y-3">
            {completed.map((c) => (
              <ClosedCompetitionCard key={c.id} comp={c} isManager={isManager} onOpenDetails={() => setDetailsId(c.id)} />
            ))}
          </div>
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <h2 className="text-lg font-bold mb-3">ארכיון תחרויות</h2>
          <p className="text-xs text-muted-foreground mb-3">
            תחרויות שהועברו לארכיון הן רשומה קפואה לצפייה — ניתן לשחזר אותן בכל עת.
          </p>
          <div className="space-y-3">
            {archived.map((c) => (
              <ClosedCompetitionCard key={c.id} comp={c} isManager={isManager} onOpenDetails={() => setDetailsId(c.id)} />
            ))}
          </div>
        </div>
      )}

      <CompetitionDetailsSheet comp={detailsComp} onOpenChange={(o) => !o && setDetailsId(null)} isManager={isManager} />
    </div>
  );
}

function ActiveCompetitionCard({ comp, onClose, isManager }: { comp: Competition; onClose: () => void; isManager: boolean }) {
  const { state, addCompetitionCategory, removeCompetitionCategory, setCompetitionScore } = useApp();
  const nameOf = (id: string) => state.reps.find((r) => r.id === id)?.name ?? "—";

  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-l from-primary to-primary/80 text-primary-foreground p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              <h2 className="text-xl md:text-2xl font-extrabold">{comp.name}</h2>
              <CompetitionStatusBadge comp={comp} />
            </div>
            <CompetitionDateRange start={comp.startDate} end={comp.endDate} className="text-sm opacity-90 mt-1 block" />
          </div>
          {isManager && (
            <div className="flex gap-2">
              <CompetitionFormDialog comp={comp} trigger={<Button size="sm" variant="secondary"><Pencil className="ms-1 h-4 w-4" />עריכה</Button>} />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="secondary"><X className="ms-1 h-4 w-4" />סגירת תחרות</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>סגירת תחרות?</AlertDialogTitle>
                    <AlertDialogDescription>התחרות תסומן כמסתיימת ותופיע תחת "תחרויות שהסתיימו" — עדיין ניתנת לניהול מלא משם, כולל פתיחה מחדש.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>ביטול</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { onClose(); toast.success("התחרות נסגרה"); }}>סגירה</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      </div>

      <CardContent className="pt-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl bg-secondary p-4">
            <div className="text-xs font-semibold text-muted-foreground mb-1">חוקי התחרות</div>
            <p className="text-sm">{comp.rules}</p>
          </div>
          <div className="rounded-xl bg-secondary p-4">
            <div className="text-xs font-semibold text-muted-foreground mb-1">פרסים</div>
            <p className="text-sm">{comp.prize}</p>
          </div>
        </div>

        {/* Leaderboard */}
        <div>
          <h3 className="font-bold mb-3">טבלת מובילים</h3>
          <Leaderboard comp={comp} nameOf={nameOf} />
        </div>

        {/* Categories */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">קטגוריות ניקוד</h3>
            {isManager && (
              <AddCategoryDialog compId={comp.id} />
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {comp.categories.map((cat) => (
              <div key={cat.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{cat.label}</div>
                  <div className={`text-xs ${cat.points < 0 ? "text-primary" : "text-success-foreground"}`}>
                    {cat.points > 0 ? "+" : ""}{cat.points} נקודות ליחידה
                  </div>
                </div>
                {isManager && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" aria-label={`מחיקת הקטגוריה ${cat.label}`}><Trash2 className="h-4 w-4" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>מחיקת קטגוריה?</AlertDialogTitle>
                        <AlertDialogDescription>הפעולה תמחק גם את הניקוד שנצבר בקטגוריה זו.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>ביטול</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { removeCompetitionCategory(comp.id, cat.id); toast.success("הקטגוריה נמחקה"); }}>מחיקה</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Scores editor - manager only */}
        {isManager && comp.categories.length > 0 && (
          <div>
            <h3 className="font-bold mb-3">עדכון ניקוד לפי נציג</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>נציג</TableHead>
                    {comp.categories.map((c) => (
                      <TableHead key={c.id} className="min-w-[140px]">{c.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.reps.map((rep) => (
                    <TableRow key={rep.id}>
                      <TableCell className="font-medium">{rep.name}</TableCell>
                      {comp.categories.map((cat) => {
                        const s = comp.scores.find((x) => x.repId === rep.id && x.categoryId === cat.id);
                        return (
                          <TableCell key={cat.id}>
                            <Input
                              type="number"
                              className="w-20"
                              defaultValue={s?.count ?? 0}
                              onBlur={(e) => setCompetitionScore(comp.id, rep.id, cat.id, Number(e.target.value) || 0)}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Row for a completed/archived competition: always clickable (opens the
 * details sheet, for every viewer — the whole point of this component is
 * that a closed competition must never be a dead end), plus a manager-only
 * actions menu appropriate to its exact state.
 */
function ClosedCompetitionCard({ comp, isManager, onOpenDetails }: { comp: Competition; isManager: boolean; onOpenDetails: () => void }) {
  return (
    <Card className="card-interactive cursor-pointer" onClick={onOpenDetails}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base truncate">{comp.name}</CardTitle>
            <CompetitionStatusBadge comp={comp} />
          </div>
          <CompetitionDateRange start={comp.startDate} end={comp.endDate} className="text-sm text-muted-foreground mt-1 block" />
        </div>
        {isManager && (
          <div onClick={(e) => e.stopPropagation()}>
            <CompetitionActionsMenu comp={comp} />
          </div>
        )}
      </CardHeader>
    </Card>
  );
}

/**
 * The one actions menu shared by the closed-competition row and the details
 * sheet, so the two surfaces can never drift out of sync on what's allowed.
 */
function CompetitionActionsMenu({ comp, onDeleted }: { comp: Competition; onDeleted?: () => void }) {
  const { updateCompetition, deleteCompetition } = useApp();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const blocked = hasRecordedScores(comp);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label={`פעולות עבור ${comp.name}`}><MoreVertical className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!comp.archived ? (
            <>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); updateCompetition(comp.id, { active: true }); toast.success("התחרות נפתחה מחדש"); }}>
                <RotateCcw className="ms-2 h-4 w-4" />פתיחה מחדש
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setEditOpen(true); }}>
                <Pencil className="ms-2 h-4 w-4" />עריכת פרטים
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setArchiveOpen(true); }}>
                <Archive className="ms-2 h-4 w-4" />העברה לארכיון
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); updateCompetition(comp.id, { archived: false }); toast.success("התחרות שוחזרה מהארכיון"); }}>
              <ArchiveRestore className="ms-2 h-4 w-4" />שחזור מהארכיון
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {blocked ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <DropdownMenuItem disabled className="text-destructive/50">
                      <Trash2 className="ms-2 h-4 w-4" />מחיקה
                    </DropdownMenuItem>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-64">
                  לא ניתן למחוק תחרות עם ניקוד רשום — הוא חלק מההיסטוריה של הנציגים. ניתן להעביר אותה לארכיון במקום.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setDeleteOpen(true); }} className="text-destructive focus:text-destructive">
              <Trash2 className="ms-2 h-4 w-4" />מחיקה
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CompetitionFormDialog comp={comp} open={editOpen} onOpenChange={setEditOpen} />

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>העברת התחרות לארכיון?</AlertDialogTitle>
            <AlertDialogDescription>התחרות תעבור לארכיון כרשומה קפואה לצפייה בלבד (ללא עריכת קטגוריות או ניקוד). ניתן לשחזר אותה בכל עת.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={() => { updateCompetition(comp.id, { archived: true }); toast.success("התחרות הועברה לארכיון"); }}>העברה לארכיון</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת התחרות "{comp.name}"?</AlertDialogTitle>
            <AlertDialogDescription>הפעולה בלתי הפיכה. התחרות, הקטגוריות שלה וכל נתון משויך יימחקו לצמיתות.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={() => { deleteCompetition(comp.id); toast.success("התחרות נמחקה"); onDeleted?.(); }}>מחיקה</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Full drill-down for a completed or archived competition — every piece of
 * information the active card shows inline (metadata, categories, full
 * scores table, leaderboard), plus the same actions menu as the row it was
 * opened from. Completed competitions stay fully editable for managers
 * (categories, scores, metadata); archived ones are read-only until
 * restored, matching "archive = a frozen historical record."
 */
function CompetitionDetailsSheet({ comp, onOpenChange, isManager }: {
  comp: Competition | null; onOpenChange: (open: boolean) => void; isManager: boolean;
}) {
  const { state, removeCompetitionCategory, setCompetitionScore } = useApp();
  const nameOf = (id: string) => state.reps.find((r) => r.id === id)?.name ?? "—";
  const editable = isManager && !!comp && !comp.active && !comp.archived;

  return (
    <Sheet open={!!comp} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-xl" dir="rtl">
        {comp && (
          <div className="space-y-6">
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle>{comp.name}</SheetTitle>
                <CompetitionStatusBadge comp={comp} />
              </div>
              <SheetDescription asChild>
                <CompetitionDateRange start={comp.startDate} end={comp.endDate} />
              </SheetDescription>
            </SheetHeader>

            {isManager && !comp.active && (
              <div className="flex flex-wrap items-center gap-2">
                <CompetitionActionsMenu comp={comp} onDeleted={() => onOpenChange(false)} />
                <span className="text-xs text-muted-foreground">פעולות נוספות</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl bg-secondary p-4">
                <div className="text-xs font-semibold text-muted-foreground mb-1">חוקי התחרות</div>
                <p className="text-sm whitespace-pre-wrap">{comp.rules || "—"}</p>
              </div>
              <div className="rounded-xl bg-secondary p-4">
                <div className="text-xs font-semibold text-muted-foreground mb-1">פרסים</div>
                <p className="text-sm whitespace-pre-wrap">{comp.prize || "—"}</p>
              </div>
            </div>

            <div>
              <h3 className="font-bold mb-3">טבלת מובילים</h3>
              <Leaderboard comp={comp} nameOf={nameOf} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold">קטגוריות ניקוד</h3>
                {editable && <AddCategoryDialog compId={comp.id} />}
              </div>
              {comp.categories.length === 0 ? (
                <EmptyState icon={Trophy} title="לא הוגדרו קטגוריות" compact />
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {comp.categories.map((cat) => (
                    <div key={cat.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{cat.label}</div>
                        <div className={`text-xs ${cat.points < 0 ? "text-primary" : "text-success-foreground"}`}>
                          {cat.points > 0 ? "+" : ""}{cat.points} נקודות ליחידה
                        </div>
                      </div>
                      {editable && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label={`מחיקת הקטגוריה ${cat.label}`}><Trash2 className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>מחיקת קטגוריה?</AlertDialogTitle>
                              <AlertDialogDescription>הפעולה תמחק גם את הניקוד שנצבר בקטגוריה זו.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>ביטול</AlertDialogCancel>
                              <AlertDialogAction onClick={() => { removeCompetitionCategory(comp.id, cat.id); toast.success("הקטגוריה נמחקה"); }}>מחיקה</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {comp.categories.length > 0 && (
              <div>
                <h3 className="font-bold mb-3">ניקוד לפי נציג{!editable && " (לצפייה בלבד)"}</h3>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>נציג</TableHead>
                        {comp.categories.map((c) => (
                          <TableHead key={c.id} className="min-w-[120px]">{c.label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.reps.map((rep) => (
                        <TableRow key={rep.id}>
                          <TableCell className="font-medium">{rep.name}</TableCell>
                          {comp.categories.map((cat) => {
                            const s = comp.scores.find((x) => x.repId === rep.id && x.categoryId === cat.id);
                            return (
                              <TableCell key={cat.id}>
                                {editable ? (
                                  <Input
                                    type="number"
                                    className="w-20"
                                    defaultValue={s?.count ?? 0}
                                    onBlur={(e) => setCompetitionScore(comp.id, rep.id, cat.id, Number(e.target.value) || 0)}
                                  />
                                ) : (
                                  <span className="tabular-nums">{s?.count ?? 0}</span>
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MedalIcon({ place }: { place: number }) {
  if (place === 1) return <Medal className="h-6 w-6 text-yellow-500" />;
  if (place === 2) return <Medal className="h-6 w-6 text-gray-400" />;
  if (place === 3) return <Medal className="h-6 w-6 text-amber-700" />;
  return <div className="grid h-6 w-6 place-items-center text-xs font-bold text-muted-foreground">{place}</div>;
}

function CompetitionFormDialog({ trigger, comp, open: openProp, onOpenChange }: {
  trigger?: React.ReactNode; comp?: Competition;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const { addCompetition, updateCompetition } = useApp();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [name, setName] = useState(comp?.name ?? "");
  const [startDate, setStartDate] = useState(comp?.startDate ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(comp?.endDate ?? new Date().toISOString().slice(0, 10));
  const [rules, setRules] = useState(comp?.rules ?? "");
  const [prize, setPrize] = useState(comp?.prize ?? "");

  const submit = () => {
    if (!name.trim()) return toast.error("יש להזין שם תחרות");
    if (new Date(endDate) < new Date(startDate)) return toast.error("תאריך סיום לא יכול להיות לפני תאריך התחלה");
    if (comp) {
      updateCompetition(comp.id, { name, startDate, endDate, rules, prize });
      toast.success("התחרות עודכנה");
    } else {
      addCompetition({ name, startDate, endDate, rules, prize, categories: [], active: true });
      toast.success("התחרות נוצרה");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader><DialogTitle>{comp ? "עריכת תחרות" : "יצירת תחרות"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>שם התחרות</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>תאריך התחלה</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div className="space-y-1"><Label>תאריך סיום</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>חוקי התחרות</Label><Textarea rows={3} value={rules} onChange={(e) => setRules(e.target.value)} /></div>
          <div className="space-y-1"><Label>פרסים</Label><Textarea rows={2} value={prize} onChange={(e) => setPrize(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
          <Button onClick={submit}>{comp ? "שמירה" : "יצירה"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddCategoryDialog({ compId }: { compId: string }) {
  const { addCompetitionCategory } = useApp();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [points, setPoints] = useState<number>(1);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="ms-1 h-4 w-4" />קטגוריה</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>הוספת קטגוריה</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>שם הקטגוריה</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <div className="space-y-1"><Label>ניקוד ליחידה (חיובי או שלילי)</Label><Input type="number" value={points} onChange={(e) => setPoints(Number(e.target.value))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
          <Button onClick={() => {
            if (!label.trim()) return toast.error("יש להזין שם קטגוריה");
            addCompetitionCategory(compId, { label, points });
            toast.success("הקטגוריה נוספה");
            setOpen(false);
            setLabel(""); setPoints(1);
          }}>הוספה</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
