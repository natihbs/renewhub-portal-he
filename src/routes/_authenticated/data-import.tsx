import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Upload, FileSpreadsheet, Download, ArrowRight, ArrowLeft, ShieldAlert,
  CheckCircle2, AlertTriangle, XCircle, History, Undo2, FileDown, UserPlus, Pencil,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useIsManager, useApp, teamsFromReps } from "@/lib/store";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import { useCloudCollection } from "@/lib/cloud-hooks";
import { useCloudTeams } from "@/lib/teams-hooks";
import type { KpiValueRow } from "@/lib/kpi-values";
import { createRepresentative, updateRepresentativeMetrics } from "@/lib/rep-admin.functions";
import { setRepresentativeGoals, restoreRepresentativeGoals } from "@/lib/goals.functions";
import {
  useImport, autoMap, detectPii, PII_LABEL, type PiiHit,
  FIELD_LABEL, REQUIRED_FIELDS, UNSUPPORTED_FIELDS, UNSUPPORTED_FIELD_REASON,
  RENEWAL_FIELDS, RENEWAL_FIELDS_WRONG_PROFILE_REASON,
  type ImportFieldKey, type ImportHistoryEntry, type TargetGoalSnapshotEntry,
} from "@/lib/import-store";
import { processRows, type ProcessedRow, type ResolvedAction, type RawRow } from "@/lib/import-processing";

import type { Rep } from "@/lib/seed";
import { formatDateIL } from "@/lib/format";
import { cn } from "@/lib/utils";

import { requireRole } from "@/lib/require-role";

export const Route = createFileRoute("/_authenticated/data-import")({
  beforeLoad: () => requireRole(["admin", "manager"]),
  head: () => ({
    meta: [
      { title: "ייבוא נתונים · Pulse" },
      { name: "description", content: "העלאת דוחות ביצועים יומיים ועדכון הדשבורד" },
      { property: "og:title", content: "ייבוא נתונים · Pulse" },
      { property: "og:description", content: "העלאת דוחות ביצועים יומיים ועדכון הדשבורד" },
    ],
  }),
  component: DataImportPage,
});

const STEPS = ["העלאת קובץ", "מיפוי עמודות", "בדיקת נתונים", "אישור", "סיכום"] as const;

function StepBar({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((label, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <li key={label} className="flex items-center gap-2">
            <div className={cn(
              "grid h-7 w-7 place-items-center rounded-full text-xs font-semibold",
              done ? "bg-primary text-primary-foreground" :
              active ? "bg-primary/15 text-primary ring-2 ring-primary" :
              "bg-muted text-muted-foreground"
            )}>{i + 1}</div>
            <span className={cn("font-medium", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < STEPS.length - 1 && <ArrowLeft className="h-4 w-4 text-muted-foreground" />}
          </li>
        );
      })}
    </ol>
  );
}

function PrivacyNotice() {
  return (
    <Alert>
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>הודעת אבטחה ופרטיות</AlertTitle>
      <AlertDescription>
        המערכת מיועדת לנתוני ביצועים ניהוליים בלבד. אין להעלות פרטי לקוחות, מספרי פוליסה, תעודות זהות, מספרי טלפון או מידע רגיש אחר.
      </AlertDescription>
    </Alert>
  );
}

function downloadTemplate(kind: "xlsx" | "csv") {
  const headers = ["שם הנציג", "צוות", "יעד חודשי", "ביצוע נוכחי", "תאריך עדכון"];
  const rows = [
    ["דנה כהן", "צוות מכירות צפון", 120, 84, formatDateIL(new Date())],
    ["איתי לוי", "צוות מכירות דרום", 90, 71, formatDateIL(new Date())],
    ["מיה שטרן", "צוות מכירות צפון", 110, 45, formatDateIL(new Date())],
  ];
  if (kind === "csv") {
    const csv = Papa.unparse({ fields: headers, data: rows });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, "renewhub-import-template.csv");
  } else {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "template");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    triggerDownload(new Blob([out], { type: "application/octet-stream" }), "renewhub-import-template.xlsx");
  }
}

/** "YYYY-MM" (native month input format) -> a Hebrew "MMMM YYYY" label, e.g. "אוגוסט 2026". */
function formatMonthLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00`);
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(d);
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function parseFile(file: File): Promise<{ headers: string[]; rows: RawRow[] }> {
  const isCsv = /\.csv$/i.test(file.name);
  if (isCsv) {
    return new Promise((resolve, reject) => {
      Papa.parse<RawRow>(file, {
        header: true, skipEmptyLines: true,
        complete: (res) => {
          const headers = (res.meta.fields ?? []).map((h) => String(h).trim()).filter(Boolean);
          resolve({ headers, rows: res.data as RawRow[] });
        },
        error: reject,
      });
    });
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "", raw: true });
  const headers = Object.keys(json[0] ?? {});
  return { headers, rows: json };
}

function DataImportPage() {
  const isManager = useIsManager();
  const { state, updateRep, addRep, replaceReps } = useApp();
  const { isDemo } = useAppMode();
  const { profile, user } = useAuth();
  const { teams: cloudTeams } = useCloudTeams();
  const demoTeams = useMemo(() => teamsFromReps(state.reps).map((t) => ({ id: t.teamId, name: t.teamName })), [state.reps]);
  const teamsForResolution = isDemo ? demoTeams : cloudTeams;
  const importStore = useImport();
  const kpiValuesCloud = useCloudCollection<KpiValueRow>("kpi_values");
  const qc = useQueryClient();
  const createRepFn = useServerFn(createRepresentative);
  const updateMetricsFn = useServerFn(updateRepresentativeMetrics);
  const setGoalsFn = useServerFn(setRepresentativeGoals);
  const restoreGoalsFn = useServerFn(restoreRepresentativeGoals);
  const importedByName = profile?.full_name || user?.email || "לא ידוע";

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, ImportFieldKey>>({});
  const [processed, setProcessed] = useState<ProcessedRow[]>([]);
  const [busy, setBusy] = useState(false);
  // Default OFF: a target column in the file is read and shown in preview,
  // but never applied as the official monthly target unless the user
  // explicitly opts in here (§20) — performance data (name/team/result)
  // always imports regardless of this toggle.
  const [applyTargetsFromImport, setApplyTargetsFromImport] = useState(false);
  // "YYYY-MM", explicit target month for the import (§20 correction #3).
  // Seeded with a default only when every row in the file reports the same
  // reporting month (see goToPreview) — otherwise left blank, forcing an
  // explicit choice before target writes can be confirmed. Never silently
  // defaults to "now".
  const [importTargetMonth, setImportTargetMonth] = useState("");
  const [lastSummary, setLastSummary] = useState<ImportHistoryEntry | null>(null);
  const [piiBlock, setPiiBlock] = useState<{ fileName: string; hits: PiiHit[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isManager) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState icon={ShieldAlert} title="אזור למנהלים בלבד"
            description='כדי לצפות בעמוד זה יש להחליף למצב "מנהל" מתפריט הבחירה שבראש המסך.' />
        </CardContent>
      </Card>
    );
  }

  async function onFile(f: File) {
    setBusy(true);
    try {
      const { headers: hs, rows: rs } = await parseFile(f);
      if (hs.length === 0) throw new Error("לא נמצאו עמודות בקובץ");
      const hits = detectPii(hs, rs);
      if (hits.length > 0) {
        setPiiBlock({ fileName: f.name, hits });
        toast.error("הייבוא נחסם", { description: "הקובץ מכיל מידע רגיש. פרטים בחלון שנפתח." });
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      setFile(f); setHeaders(hs); setRows(rs);
      setMapping(autoMap(hs));
      setStep(1);
      toast.success(`נטענו ${rs.length} שורות מ־${f.name}`);
    } catch (e) {
      toast.error("שגיאה בקריאת הקובץ", { description: String((e as Error).message ?? e) });
    } finally { setBusy(false); }
  }


  function goToPreview() {
    const missing = REQUIRED_FIELDS.filter((f) => !Object.values(mapping).includes(f));
    if (missing.length > 0) {
      toast.error("חסרות עמודות חובה", { description: missing.map((m) => FIELD_LABEL[m]).join(", ") });
      return;
    }
    const rows2 = processRows(rows, mapping, state.reps, teamsForResolution);
    setProcessed(rows2);
    // A "reliable" default target month exists only when every importable
    // row's own reporting date (תאריך עדכון) agrees on the same calendar
    // month — never "now". Any disagreement, or no dates at all, leaves the
    // picker blank and requires an explicit choice (§20 correction #3).
    const reportedMonths = new Set(
      rows2.filter((r) => r.action !== "skip" && r.updatedAt).map((r) => r.updatedAt!.slice(0, 7)),
    );
    setImportTargetMonth(reportedMonths.size === 1 ? [...reportedMonths][0] : "");
    setStep(2);
  }

  async function applyImport() {
    setBusy(true);
    try {
      const snapshot = state.reps.map((r) => ({ ...r }));
      const errorReport: ImportHistoryEntry["errorReport"] = [];
      let updated = 0, created = 0, skipped = 0, warns = 0, errs = 0, cloudFailed = 0;
      const now = new Date().toISOString().slice(0, 10);
      const byId = new Map(state.reps.map((r) => [r.id, r] as const));
      // Official-target write candidates, collected only for rows whose
      // performance-data write already succeeded — never mixed into the
      // representatives.monthly_target column, and only applied at all when
      // the user explicitly opted in (applyTargetsFromImport, §20).
      const targetCandidates: { repId: string; teamId: string | null; targetValue: number }[] = [];

      for (const r of processed) {
        const rowErrors = r.issues.filter((i) => i.severity === "error");
        const rowWarns = r.issues.filter((i) => i.severity === "warning");
        warns += rowWarns.length;
        if (r.action === "skip" || rowErrors.length > 0) {
          skipped++;
          if (rowErrors.length > 0) errs += rowErrors.length;
          if (r.issues.length > 0) {
            errorReport!.push({ row: r.index + 2, name: r.name, messages: r.issues.map((i) => `${i.severity === "error" ? "שגיאה" : "אזהרה"}: ${i.message}`) });
          }
          continue;
        }
        const updatedAt = r.updatedAt ?? now;
        let repIdForRenewal: string | null = null;
        try {
          if (r.action === "update" && r.matchRepId) {
            const existing = byId.get(r.matchRepId);
            if (!existing) throw new Error("הנציג המקורי לא נמצא — יתכן שהוסר");
            if (isDemo) {
              updateRep(existing.id, {
                currentResult: r.currentResult ?? existing.currentResult,
                teamId: r.teamId ?? existing.teamId,
                teamName: r.teamName ?? existing.teamName,
                lastUpdatedAt: updatedAt,
              });
            } else {
              // Performance data only — monthly_target is never written from
              // an import. Official targets (if opted in) are written
              // separately below, to representative_goals.
              await updateMetricsFn({
                data: {
                  rep_id: existing.id,
                  current_result: r.currentResult ?? undefined,
                  team_id: r.teamId ?? undefined,
                },
              });
            }
            repIdForRenewal = existing.id;
            updated++;
          } else if (r.action === "create") {
            if (isDemo) {
              addRep({
                name: r.name, teamId: r.teamId, teamName: r.teamName ?? "ללא צוות",
                monthlyTarget: 0, currentResult: r.currentResult!, lastUpdatedAt: updatedAt,
              });
            } else {
              const createdRep = await createRepFn({
                data: {
                  name: r.name, team_id: r.teamId, current_result: r.currentResult!,
                  external_ref: null, user_id: null, active: true,
                },
              });
              repIdForRenewal = createdRep.rep_id;
            }
            created++;
          }
        } catch (e) {
          cloudFailed++;
          errs++;
          errorReport!.push({ row: r.index + 2, name: r.name, messages: [`שגיאת שמירה בענן: ${(e as Error).message ?? e}`] });
          continue;
        }

        if (!isDemo && repIdForRenewal && r.monthlyTarget != null) {
          targetCandidates.push({ repId: repIdForRenewal, teamId: r.teamId, targetValue: r.monthlyTarget });
        }

        // Renewal values are a second, independent write — a failure here must never
        // be reported as import success, but also must not undo the target/result
        // write that already succeeded above.
        if (!isDemo && repIdForRenewal && (r.renewalOpportunities != null || r.completedRenewals != null)) {
          try {
            await kpiValuesCloud.upsert(
              {
                representative_id: repIdForRenewal,
                team_id: r.teamId,
                metric_date: updatedAt,
                renewal_opportunities: r.renewalOpportunities,
                completed_renewals: r.completedRenewals,
                source_import_id: null,
              },
              "representative_id,metric_date",
            );
          } catch (e) {
            errs++;
            errorReport!.push({ row: r.index + 2, name: r.name, messages: [`שגיאת שמירת נתוני חידוש: ${(e as Error).message ?? e}`] });
          }
        }
      }

      // Official target write — opt-in only, explicit target month only
      // (§20 corrections #3/#4). Grouped by team since setRepresentativeGoals
      // authorizes and validates one team at a time (admin, or the manager of
      // that specific team); a row whose rep has no team can't be assigned an
      // official target this way and is reported as skipped rather than
      // silently dropped. Every write also captures a restore point
      // (targetGoalSnapshot) so undo can put things back exactly, per row —
      // never a generic "clear everything" undo.
      let targetsSet = 0, targetsSkippedNoTeam = 0, targetsFailed = 0;
      const targetGoalSnapshot: TargetGoalSnapshotEntry[] = [];
      if (!isDemo && applyTargetsFromImport && targetCandidates.length > 0 && importTargetMonth) {
        const byTeam = new Map<string, { representative_id: string; target_value: number }[]>();
        for (const c of targetCandidates) {
          if (!c.teamId) { targetsSkippedNoTeam++; continue; }
          const list = byTeam.get(c.teamId) ?? [];
          list.push({ representative_id: c.repId, target_value: c.targetValue });
          byTeam.set(c.teamId, list);
        }
        for (const [teamId, goals] of byTeam) {
          try {
            const res = await setGoalsFn({ data: { team_id: teamId, month: importTargetMonth, goals } });
            targetsSet += res.created + res.updated;
            const goalMonth = `${importTargetMonth}-01`;
            for (const p of res.previously_existing) {
              targetGoalSnapshot.push({
                representativeId: p.representative_id, teamId, goalMonth,
                hadPrevious: true, previousTargetValue: p.target_value,
              });
            }
            for (const repId of res.newly_created_representative_ids) {
              targetGoalSnapshot.push({
                representativeId: repId, teamId, goalMonth,
                hadPrevious: false, previousTargetValue: null,
              });
            }
          } catch (e) {
            targetsFailed += goals.length;
            errorReport!.push({
              row: 0, name: undefined,
              messages: [`עדכון יעדים רשמיים נכשל עבור צוות (${goals.length} נציגים): ${(e as Error).message ?? e}`],
            });
          }
        }
      }

      if (!isDemo) {
        void qc.invalidateQueries({ queryKey: ["representatives"] });
        if (applyTargetsFromImport) void qc.invalidateQueries({ queryKey: ["cloud", "representative_goals"] });
      }

      const status: ImportHistoryEntry["status"] =
        cloudFailed > 0 ? (updated + created === 0 ? "failed" : "partial") : (errs > 0 ? "partial" : "success");

      const entry = importStore.pushHistory({
        fileName: file?.name ?? "unknown",
        importedBy: importedByName,
        rowsProcessed: processed.length,
        rowsUpdated: updated,
        rowsCreated: created,
        rowsSkipped: skipped,
        warnings: warns,
        errors: errs,
        status,
        snapshot: { reps: snapshot, targetGoals: targetGoalSnapshot },
        errorReport,
      });
      setLastSummary(entry);
      setStep(4);

      const monthLabel = importTargetMonth ? formatMonthLabel(importTargetMonth) : "";
      const targetsNote = !applyTargetsFromImport
        ? undefined
        : targetsFailed > 0
        ? ` · יעדים רשמיים לחודש ${monthLabel}: ${targetsSet} עודכנו, ${targetsFailed} נכשלו${targetsSkippedNoTeam ? `, ${targetsSkippedNoTeam} דולגו (ללא צוות)` : ""}`
        : ` · יעדים רשמיים לחודש ${monthLabel}: ${targetsSet} עודכנו${targetsSkippedNoTeam ? `, ${targetsSkippedNoTeam} דולגו (ללא צוות)` : ""}`;

      // Never report success unless every cloud write actually succeeded.
      if (cloudFailed > 0 || targetsFailed > 0) {
        toast.error("הייבוא הושלם עם שגיאות שמירה", {
          description: `${updated} עודכנו, ${created} נוספו, ${cloudFailed} נכשלו בשמירה בענן — פרטים בדוח השגיאות${targetsNote ?? ""}`,
        });
      } else if (isDemo) {
        toast.success("הייבוא הושלם (מצב הדגמה — לא נשמר בענן)", { description: `${updated} עודכנו, ${created} נוספו, ${skipped} דולגו` });
      } else {
        toast.success("הייבוא נשמר בהצלחה בענן", { description: `${updated} עודכנו, ${created} נוספו, ${skipped} דולגו${targetsNote ?? ""}` });
      }
    } catch (e) {
      toast.error("שגיאה בייבוא", { description: String((e as Error).message ?? e) });
    } finally { setBusy(false); }
  }

  function resetWizard() {
    setFile(null); setHeaders([]); setRows([]); setMapping({}); setProcessed([]); setLastSummary(null);
    setStep(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const criticalCount = processed.filter((p) => p.issues.some((i) => i.severity === "error")).length;
  const warnCount = processed.reduce((a, p) => a + p.issues.filter((i) => i.severity === "warning").length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="ייבוא נתונים"
        description="העלאת דוח ביצועים יומי ועדכון אוטומטי של הדשבורד"

        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadTemplate("xlsx")}>
              <Download className="me-1 h-4 w-4" /> הורדת תבנית (Excel)
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadTemplate("csv")}>
              <Download className="me-1 h-4 w-4" /> הורדת תבנית (CSV)
            </Button>
            <ManualEntryDialog />
          </div>
        }
      />

      <PrivacyNotice />

      <Card>
        <CardHeader className="pb-3"><StepBar step={step} /></CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <UploadStep onFile={onFile} busy={busy} inputRef={fileInputRef} />
          )}
          {step === 1 && (
            <MappingStep
              headers={headers} mapping={mapping} setMapping={setMapping}
              templates={importStore.templates}
              onSaveTemplate={(name) => { importStore.saveTemplate(name, mapping); toast.success("תבנית נשמרה"); }}
              onApplyTemplate={(id) => {
                const t = importStore.templates.find((x) => x.id === id);
                if (t) {
                  const next: Record<string, ImportFieldKey> = {};
                  for (const h of headers) next[h] = t.mapping[h] ?? "__skip__";
                  setMapping(next);
                  toast.success(`הוחלה תבנית: ${t.name}`);
                }
              }}
              onBack={() => setStep(0)} onNext={goToPreview}
            />
          )}
          {step === 2 && (
            <PreviewStep
              processed={processed} reps={state.reps}
              onChangeAction={(idx, action, matchId) =>
                setProcessed((p) => p.map((r) => r.index === idx ? { ...r, action, matchRepId: matchId ?? r.matchRepId } : r))
              }
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
              criticalCount={criticalCount} warnCount={warnCount}
            />
          )}
          {step === 3 && (
            <ConfirmStep
              processed={processed} fileName={file?.name ?? ""} criticalCount={criticalCount} warnCount={warnCount}
              onBack={() => setStep(2)} onConfirm={applyImport} busy={busy}
              isDemo={isDemo}
              applyTargetsFromImport={applyTargetsFromImport}
              onApplyTargetsFromImportChange={setApplyTargetsFromImport}
              importTargetMonth={importTargetMonth}
              onImportTargetMonthChange={setImportTargetMonth}
            />
          )}
          {step === 4 && lastSummary && (
            <SummaryStep entry={lastSummary} onNew={resetWizard} />
          )}
        </CardContent>
      </Card>

      <HistoryCard
        history={importStore.history}
        onUndo={async (entry) => {
          if (!entry.snapshot) { toast.error("לא ניתן לשחזר – אין תמונת מצב שמורה"); return; }
          if (isDemo) {
            replaceReps(entry.snapshot.reps);
            importStore.removeHistory(entry.id);
            toast.success("הייבוא האחרון בוטל והנתונים שוחזרו (מצב הדגמה)");
            return;
          }
          setBusy(true);
          try {
            // Part 1: performance data (result/team). Representatives
            // CREATED by this import are not deleted by undo — remove them
            // manually from /representatives if needed.
            let repsFailed = 0;
            for (const prevRep of entry.snapshot.reps) {
              try {
                await updateMetricsFn({
                  data: { rep_id: prevRep.id, current_result: prevRep.currentResult, team_id: prevRep.teamId },
                });
              } catch {
                repsFailed++;
              }
            }

            // Part 2: official monthly targets — target-aware undo (§4).
            // Restores each representative_goals row to its exact prior
            // state (or deletes it if it didn't exist before this import),
            // grouped by team since restoreRepresentativeGoals authorizes
            // one team at a time. A generic "the reps are back to normal" is
            // never presented as if targets were handled too — the two
            // outcomes are tracked and reported completely separately.
            let goalsRestored = 0, goalsDeleted = 0, goalsFailed = 0;
            const snapshotEntries = entry.snapshot.targetGoals;
            if (snapshotEntries.length > 0) {
              const byTeam = new Map<string, TargetGoalSnapshotEntry[]>();
              for (const g of snapshotEntries) {
                const list = byTeam.get(g.teamId) ?? [];
                list.push(g);
                byTeam.set(g.teamId, list);
              }
              for (const [teamId, entries] of byTeam) {
                const goalMonth = entries[0].goalMonth;
                try {
                  const res = await restoreGoalsFn({
                    data: {
                      team_id: teamId, month: goalMonth,
                      entries: entries.map((e) => (e.hadPrevious
                        ? { representative_id: e.representativeId, had_previous: true as const, previous_target_value: e.previousTargetValue as number }
                        : { representative_id: e.representativeId, had_previous: false as const, previous_target_value: null })),
                    },
                  });
                  goalsRestored += res.restored;
                  goalsDeleted += res.deleted;
                  goalsFailed += res.failed;
                } catch {
                  goalsFailed += entries.length;
                }
              }
            }

            void qc.invalidateQueries({ queryKey: ["representatives"] });
            if (snapshotEntries.length > 0) void qc.invalidateQueries({ queryKey: ["cloud", "representative_goals"] });
            importStore.removeHistory(entry.id);

            const goalsNote = snapshotEntries.length === 0
              ? ""
              : goalsFailed > 0
              ? ` יעדים רשמיים: ${goalsRestored + goalsDeleted} שוחזרו, ${goalsFailed} נכשלו — יש לבדוק במסך ניהול היעדים.`
              : ` יעדים רשמיים: ${goalsRestored + goalsDeleted} שוחזרו בהצלחה.`;

            if (repsFailed > 0 || goalsFailed > 0) {
              toast.error("הביטול הושלם חלקית", {
                description: `${repsFailed > 0 ? `${repsFailed} נציגים לא שוחזרו בהצלחה. ` : ""}נציגים חדשים שנוצרו בייבוא זה לא הוסרו.${goalsNote}`,
              });
            } else {
              toast.success("הייבוא האחרון בוטל ושוחזר בענן", {
                description: `נציגים חדשים שנוצרו בייבוא זה לא הוסרו.${goalsNote}`,
              });
            }
          } finally {
            setBusy(false);
          }
        }}
      />

      <PiiBlockDialog data={piiBlock} onClose={() => setPiiBlock(null)} />
    </div>
  );
}

function PiiBlockDialog({ data, onClose }: { data: { fileName: string; hits: PiiHit[] } | null; onClose: () => void }) {
  return (
    <Dialog open={!!data} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="mb-2 grid h-11 w-11 place-items-center rounded-xl bg-destructive/10 text-destructive">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <DialogTitle>הייבוא נחסם – זוהה מידע רגיש</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            לא ניתן לייבא את הקובץ <b>{data?.fileName}</b> משום שהוא מכיל מידע שאין להעלות למערכת:
            תעודות זהות, מספרי טלפון, כתובות אימייל או מספרי פוליסה.
          </p>
          <p className="text-muted-foreground">
            Pulse מיועדת לניהול ביצועים בלבד. יש להסיר את העמודות הרגישות מהקובץ ולנסות שוב.
          </p>
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">נמצא בקובץ</div>
            <ul className="space-y-1.5">
              {data?.hits.map((h, i) => (
                <li key={i} className="flex items-start justify-between gap-3">
                  <span>
                    <b>{PII_LABEL[h.kind]}</b> בעמודה <code className="rounded bg-background px-1 py-0.5 text-xs">{h.column}</code>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">שורה {h.sampleRow} · {h.sample}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>הבנתי</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ---------- Step: Upload ----------

function UploadStep({ onFile, busy, inputRef }: { onFile: (f: File) => void; busy: boolean; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0]; if (f) onFile(f);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
        drag ? "border-primary bg-primary/5" : "border-border bg-muted/30"
      )}
    >
      <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
        <Upload className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <div className="text-base font-semibold">גררו קובץ Excel או CSV לכאן</div>
        <div className="text-sm text-muted-foreground">או לחצו על הכפתור לבחירת קובץ מהמחשב</div>
      </div>
      <input
        ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      <Button onClick={() => inputRef.current?.click()} disabled={busy}>
        <FileSpreadsheet className="me-1 h-4 w-4" /> בחירת קובץ
      </Button>
      <div className="text-xs text-muted-foreground">
        נתמכים: .xlsx, .csv &middot; העיבוד מתבצע בדפדפן, הקובץ אינו נשלח לשרת
      </div>
    </div>
  );
}

// ---------- Step: Mapping ----------

function MappingStep({
  headers, mapping, setMapping, templates, onSaveTemplate, onApplyTemplate, onBack, onNext,
}: {
  headers: string[]; mapping: Record<string, ImportFieldKey>;
  setMapping: (m: Record<string, ImportFieldKey>) => void;
  templates: { id: string; name: string }[];
  onSaveTemplate: (name: string) => void;
  onApplyTemplate: (id: string) => void;
  onBack: () => void; onNext: () => void;
}) {
  const [tplName, setTplName] = useState("");
  const usedFields = useMemo(
    () => new Set<ImportFieldKey>(Object.values(mapping).filter((v): v is Exclude<ImportFieldKey, "__skip__"> => v !== "__skip__")),
    [mapping]
  );
  const missingRequired = REQUIRED_FIELDS.filter((f) => !usedFields.has(f));


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          התאימו כל עמודה מהקובץ לשדה במערכת. שדות חובה: {REQUIRED_FIELDS.map((f) => FIELD_LABEL[f]).join(", ")}.
        </p>
        {templates.length > 0 && (
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">תבנית שמורה</Label>
            <Select onValueChange={onApplyTemplate}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder="בחר תבנית..." /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>עמודה בקובץ</TableHead>
              <TableHead>שדה במערכת</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {headers.map((h) => (
              <TableRow key={h}>
                <TableCell className="font-medium">{h}</TableCell>
                <TableCell>
                  <Select
                    value={mapping[h] ?? "__skip__"}
                    onValueChange={(v) => setMapping({ ...mapping, [h]: v as ImportFieldKey })}
                  >
                    <SelectTrigger className="h-9 w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(FIELD_LABEL) as ImportFieldKey[]).map((f) => (
                        <SelectItem key={f} value={f}
                          disabled={(f !== "__skip__" && f !== mapping[h] && usedFields.has(f)) || UNSUPPORTED_FIELDS.includes(f)}>
                          {FIELD_LABEL[f]} {REQUIRED_FIELDS.includes(f) && f !== "__skip__" && <span className="text-primary">*</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ColumnPlan headers={headers} mapping={mapping} />

      {missingRequired.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>חסרות עמודות חובה</AlertTitle>
          <AlertDescription>{missingRequired.map((f) => FIELD_LABEL[f]).join(", ")}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Input placeholder="שם תבנית לשמירה" value={tplName} onChange={(e) => setTplName(e.target.value)} className="h-9 w-56" />
          <Button variant="outline" size="sm" disabled={!tplName.trim()} onClick={() => { onSaveTemplate(tplName.trim()); setTplName(""); }}>
            שמור תבנית
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}><ArrowRight className="me-1 h-4 w-4" /> חזרה</Button>
          <Button onClick={onNext} disabled={missingRequired.length > 0}>המשך לבדיקה <ArrowLeft className="ms-1 h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Explicit, visible accounting of what will happen to every column before the user
 * can proceed — required so a mapped column can never be silently validated and then
 * discarded without the user being told. Three buckets only: persisted, skipped
 * (mapped to "— התעלם —" or left unmapped), or unsupported (mapped to a recognized
 * field that isn't backed by a persistence path yet).
 */
function ColumnPlan({ headers, mapping }: { headers: string[]; mapping: Record<string, ImportFieldKey> }) {
  const persisted = headers.filter((h) => {
    const f = mapping[h];
    return f && f !== "__skip__" && f !== "monthlyTarget" && !UNSUPPORTED_FIELDS.includes(f) && !RENEWAL_FIELDS.includes(f);
  });
  // Called out separately from the plain "יישמרו במערכת" bucket: unlike
  // every other persisted field, this one is never written just because it's
  // mapped — it requires the explicit opt-in in the confirmation step, and
  // when applied it goes to the official target system, not the
  // representative's row (§20).
  const targetMapped = headers.some((h) => mapping[h] === "monthlyTarget");
  const renewal = headers.filter((h) => {
    const f = mapping[h];
    return !!f && RENEWAL_FIELDS.includes(f);
  });
  const unsupported = headers.filter((h) => {
    const f = mapping[h];
    return !!f && UNSUPPORTED_FIELDS.includes(f);
  });
  const skipped = headers.filter((h) => !mapping[h] || mapping[h] === "__skip__");

  return (
    <div className="rounded-lg border bg-muted/20 p-3 text-sm space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">מה יקרה לכל עמודה בייבוא</div>
      <div>
        <span className="font-medium text-success-foreground">יישמרו במערכת:</span>{" "}
        {persisted.length > 0 ? persisted.join(", ") : "—"}
      </div>
      {targetMapped && (
        <div>
          <span className="font-medium text-primary">יעד חודשי — לא יישמר אוטומטית:</span>{" "}
          הערכים יוצגו בבדיקת הנתונים, אך היעד הרשמי של נציג משתנה רק אם תאשרו זאת מפורשות בשלב האישור.
          ביצוע נוכחי מתעדכן תמיד, ללא תלות באפשרות זו.
        </div>
      )}
      {renewal.length > 0 && (
        <div>
          <span className="font-medium text-primary">יישמרו כנתוני חידוש — רק לשורות בצוות "חידושים":</span>{" "}
          {renewal.join(", ")}
          <div className="text-xs text-muted-foreground">{RENEWAL_FIELDS_WRONG_PROFILE_REASON}</div>
        </div>
      )}
      <div>
        <span className="font-medium text-muted-foreground">ידולגו (לא נבחר שדה):</span>{" "}
        {skipped.length > 0 ? skipped.join(", ") : "—"}
      </div>
      {unsupported.length > 0 && (
        <div>
          <span className="font-medium text-warning-foreground">לא ייכתבו למערכת:</span> {unsupported.join(", ")}
          <div className="text-xs text-muted-foreground">{UNSUPPORTED_FIELD_REASON}</div>
        </div>
      )}
    </div>
  );
}

// ---------- Step: Preview ----------

function PreviewStep({
  processed, reps, onChangeAction, onBack, onNext, criticalCount, warnCount,
}: {
  processed: ProcessedRow[]; reps: Rep[];
  onChangeAction: (idx: number, action: ResolvedAction, matchId?: string) => void;
  onBack: () => void; onNext: () => void;
  criticalCount: number; warnCount: number;
}) {
  const shown = processed.slice(0, 20);
  const showRenewalColumns = processed.some(
    (p) => p.renewalOpportunities != null || p.completedRenewals != null || p.renewalFieldsSkipped,
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatChip label="שורות" value={processed.length} tone="muted" />
        <StatChip label="לעדכון" value={processed.filter((p) => p.action === "update").length} tone="success" />
        <StatChip label="חדשים" value={processed.filter((p) => p.action === "create").length} tone="info" />
        <StatChip label="שגיאות" value={criticalCount} tone={criticalCount > 0 ? "danger" : "muted"} />
      </div>

      {warnCount > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>ישנן {warnCount} אזהרות</AlertTitle>
          <AlertDescription>ניתן להמשיך בייבוא – השורות עם שגיאות ידולגו אוטומטית.</AlertDescription>
        </Alert>
      )}

      <div className="text-xs text-muted-foreground">מוצגות 20 השורות הראשונות מתוך {processed.length}.</div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>שם</TableHead>
              <TableHead>צוות</TableHead>
              <TableHead>יעד (מהקובץ)</TableHead>
              <TableHead>ביצוע</TableHead>
              {showRenewalColumns && <TableHead>הזדמנויות חידוש</TableHead>}
              {showRenewalColumns && <TableHead>חידושים שבוצעו</TableHead>}
              <TableHead>תאריך</TableHead>
              <TableHead>סטטוס</TableHead>
              <TableHead>פעולה</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => {
              const hasErr = r.issues.some((i) => i.severity === "error");
              return (
                <TableRow key={r.index} className={cn(hasErr && "bg-destructive/5")}>
                  <TableCell className="text-muted-foreground">{r.index + 1}</TableCell>
                  <TableCell className={cn("font-medium", !r.name && "text-destructive")}>{r.name || "—"}</TableCell>
                  <TableCell>{r.teamName ? r.teamName : <span className="text-warning-foreground">{r.teamRaw ? `לא מזוהה: ${r.teamRaw}` : "ללא צוות"}</span>}</TableCell>
                  <TableCell>{r.monthlyTarget ?? "—"}</TableCell>
                  <TableCell>{r.currentResult ?? "—"}</TableCell>
                  {showRenewalColumns && (
                    <TableCell className={cn(r.renewalFieldsSkipped && "text-warning-foreground")}>
                      {r.renewalOpportunities ?? (r.renewalFieldsSkipped ? "לא יישמר" : "—")}
                    </TableCell>
                  )}
                  {showRenewalColumns && (
                    <TableCell className={cn(r.renewalFieldsSkipped && "text-warning-foreground")}>
                      {r.completedRenewals ?? (r.renewalFieldsSkipped ? "לא יישמר" : "—")}
                    </TableCell>
                  )}
                  <TableCell>{r.updatedAt ?? <span className="text-destructive">—</span>}</TableCell>
                  <TableCell className="space-y-1">
                    {r.issues.length === 0 ? (
                      <Badge variant="secondary" className="bg-[color:var(--success)]/15 text-success-foreground">תקין</Badge>
                    ) : r.issues.map((i, k) => (
                      <div key={k} className={cn("text-xs", i.severity === "error" ? "text-destructive" : "text-warning-foreground")}>
                        {i.severity === "error" ? <XCircle className="inline h-3 w-3 me-1" /> : <AlertTriangle className="inline h-3 w-3 me-1" />}
                        {i.message}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={r.action}
                      onValueChange={(v) => onChangeAction(r.index, v as ResolvedAction)}
                      disabled={hasErr}
                    >
                      <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="update" disabled={!r.matchRepId}>
                          עדכון {r.matchRepId ? `(${reps.find((x) => x.id === r.matchRepId)?.name})` : ""}
                        </SelectItem>
                        <SelectItem value="create">יצירת נציג חדש</SelectItem>
                        <SelectItem value="skip">דילוג</SelectItem>
                      </SelectContent>
                    </Select>
                    {!r.matchRepId && !hasErr && (
                      <ManualMatchDialog reps={reps} onPick={(id) => onChangeAction(r.index, "update", id)} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}><ArrowRight className="me-1 h-4 w-4" /> חזרה</Button>
        <Button onClick={onNext}>המשך לאישור <ArrowLeft className="ms-1 h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function ManualMatchDialog({ reps, onPick }: { reps: Rep[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = reps.filter((r) => r.name.includes(q));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs">
          <Pencil className="h-3 w-3 me-1" /> התאמה ידנית
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>התאמה ידנית לנציג קיים</DialogTitle></DialogHeader>
        <Input placeholder="חיפוש..." value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 overflow-y-auto rounded border">
          {filtered.map((r) => (
            <button key={r.id} type="button" onClick={() => { onPick(r.id); setOpen(false); }}
              className="flex w-full items-center justify-between p-2 text-start hover:bg-accent">
              <span>{r.name}</span>
              <span className="text-xs text-muted-foreground">{r.teamName}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="p-4 text-center text-sm text-muted-foreground">לא נמצאו נציגים</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Step: Confirm ----------

function ConfirmStep({
  processed, fileName, criticalCount, warnCount, onBack, onConfirm, busy,
  isDemo, applyTargetsFromImport, onApplyTargetsFromImportChange,
  importTargetMonth, onImportTargetMonthChange,
}: {
  processed: ProcessedRow[]; fileName: string; criticalCount: number; warnCount: number;
  onBack: () => void; onConfirm: () => void; busy: boolean;
  isDemo: boolean; applyTargetsFromImport: boolean; onApplyTargetsFromImportChange: (v: boolean) => void;
  importTargetMonth: string; onImportTargetMonthChange: (v: string) => void;
}) {
  const updateN = processed.filter((p) => p.action === "update").length;
  const createN = processed.filter((p) => p.action === "create").length;
  const skipN = processed.length - updateN - createN;
  const targetRowsN = processed.filter((p) => p.action !== "skip" && p.monthlyTarget != null).length;
  // Confirming an import that would write official targets requires an
  // explicit target month — never silently falls back to "now" (§20
  // correction #3).
  const monthMissing = applyTargetsFromImport && !importTargetMonth;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatChip label="לעדכון" value={updateN} tone="success" />
        <StatChip label="חדשים" value={createN} tone="info" />
        <StatChip label="ידולגו" value={skipN} tone="muted" />
      </div>
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>סיכום לפני ייבוא</AlertTitle>
        <AlertDescription>
          קובץ: <b>{fileName}</b>. סה"כ {processed.length} שורות · {warnCount} אזהרות · {criticalCount} שגיאות.
          פעולה זו לא תשנה הערות מנהל, האזנות, משימות, מאמרים או תחרויות.
        </AlertDescription>
      </Alert>

      {!isDemo && targetRowsN > 0 && (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="font-medium text-sm">עדכון יעדים אישיים רשמיים מהקובץ</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                הקובץ מכיל עמודת "יעד חודשי" עם ערך עבור {targetRowsN} שורות. כברירת מחדל היעדים הרשמיים
                (המוצגים ב"ניהול יעדים") אינם משתנים מייבוא — רק הביצוע הנוכחי מתעדכן. הפעלת האפשרות הזו
                תעדכן את היעד האישי הרשמי לחודש שייבחר למטה עבור כל נציג עם ערך יעד בשורה, ותדרוס יעד רשמי
                קיים לאותו חודש אם הוגדר. נציג ללא צוות משויך לא יעודכן בדרך זו.
              </p>
            </div>
            <Switch checked={applyTargetsFromImport} onCheckedChange={onApplyTargetsFromImportChange} className="shrink-0 mt-1" />
          </div>

          {applyTargetsFromImport && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 p-3">
              <Label htmlFor="import-target-month" className="text-sm shrink-0">חודש יעד לייבוא</Label>
              <Input
                id="import-target-month" type="month" value={importTargetMonth}
                onChange={(e) => onImportTargetMonthChange(e.target.value)}
                className="w-auto"
              />
              {importTargetMonth ? (
                <span className="text-sm text-muted-foreground">
                  היעדים יעודכנו עבור <b className="text-foreground">{formatMonthLabel(importTargetMonth)}</b> בלבד — לא חודש נוכחי אוטומטית.
                </span>
              ) : (
                <span className="text-sm text-destructive">חובה לבחור חודש לפני אישור הייבוא.</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={busy}><ArrowRight className="me-1 h-4 w-4" /> חזרה</Button>
        <Button onClick={onConfirm} disabled={busy || updateN + createN === 0 || monthMissing}>אישור וייבוא</Button>
      </div>
    </div>
  );
}

// ---------- Step: Summary ----------

function SummaryStep({ entry, onNew }: { entry: ImportHistoryEntry; onNew: () => void }) {
  return (
    <div className="space-y-4">
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>הייבוא הושלם בהצלחה</AlertTitle>
        <AlertDescription>הדשבורד, טבלת הביצועים והתובנות עודכנו בהתאם.</AlertDescription>
      </Alert>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatChip label="שורות" value={entry.rowsProcessed} tone="muted" />
        <StatChip label="עודכנו" value={entry.rowsUpdated} tone="success" />
        <StatChip label="חדשים" value={entry.rowsCreated} tone="info" />
        <StatChip label="דולגו" value={entry.rowsSkipped} tone="muted" />
        <StatChip label="אזהרות" value={entry.warnings} tone="warning" />
        <StatChip label="שגיאות" value={entry.errors} tone={entry.errors > 0 ? "danger" : "muted"} />
      </div>
      <div className="text-sm text-muted-foreground">
        קובץ: <b>{entry.fileName}</b> · תאריך: {new Date(entry.date).toLocaleString("he-IL")}
      </div>
      {entry.snapshot && entry.snapshot.targetGoals.length > 0 && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>יעדים רשמיים עודכנו</AlertTitle>
          <AlertDescription>
            עודכנו יעדים אישיים רשמיים עבור {entry.snapshot.targetGoals.length} נציגים, עבור החודש{" "}
            <b>{formatMonthLabel(entry.snapshot.targetGoals[0].goalMonth.slice(0, 7))}</b> בלבד.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button asChild><Link to="/performance">צפה בביצועים המעודכנים</Link></Button>
        <Button variant="outline" onClick={onNew}>ייבוא נוסף</Button>
      </div>
    </div>
  );
}

// ---------- History ----------

function HistoryCard({ history, onUndo }: { history: ImportHistoryEntry[]; onUndo: (e: ImportHistoryEntry) => void }) {
  const [errFor, setErrFor] = useState<ImportHistoryEntry | null>(null);
  const [detailFor, setDetailFor] = useState<ImportHistoryEntry | null>(null);
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return { date: d.toLocaleDateString("he-IL"), time: d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) };
  };
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" /> היסטוריית ייבוא</CardTitle>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <EmptyState icon={History} title="עדיין לא בוצע ייבוא" description="לאחר הייבוא הראשון תוצג כאן היסטוריה מלאה." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>תאריך</TableHead>
                  <TableHead>שעה</TableHead>
                  <TableHead>קובץ</TableHead>
                  <TableHead>נציגים עודכנו</TableHead>
                  <TableHead>אזהרות</TableHead>
                  <TableHead>שגיאות</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead>פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h, i) => {
                  const { date, time } = fmtDate(h.date);
                  return (
                    <TableRow key={h.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setDetailFor(h)}>
                      <TableCell className="whitespace-nowrap">{date}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{time}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{h.fileName}</TableCell>
                      <TableCell>{h.rowsUpdated + h.rowsCreated}</TableCell>
                      <TableCell>
                        {h.warnings > 0
                          ? <Badge variant="outline" className="bg-[color:var(--warning)]/15 text-warning-foreground border-[color:var(--warning)]/30">{h.warnings}</Badge>
                          : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell>
                        {h.errors > 0
                          ? <Badge variant="destructive">{h.errors}</Badge>
                          : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={h.status === "success" ? "secondary" : h.status === "partial" ? "outline" : "destructive"}
                          className={h.status === "success" ? "bg-[color:var(--success)]/15 text-success-foreground" : ""}>
                          {h.status === "success" ? "הושלם" : h.status === "partial" ? "חלקי" : "נכשל"}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setDetailFor(h)}>פרטים</Button>
                          <Button size="sm" variant="ghost" onClick={() => downloadErrorReport(h)}>
                            <FileDown className="h-3.5 w-3.5 me-1" /> דוח
                          </Button>
                          {i === 0 && h.snapshot && (
                            <Button size="sm" variant="outline" onClick={() => onUndo(h)}>
                              <Undo2 className="h-3.5 w-3.5 me-1" /> בטל
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!detailFor} onOpenChange={(o) => !o && setDetailFor(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>סיכום ייבוא – {detailFor?.fileName}</DialogTitle>
          </DialogHeader>
          {detailFor && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <SummaryField label="תאריך" value={fmtDate(detailFor.date).date} />
                <SummaryField label="שעה" value={fmtDate(detailFor.date).time} />
                <SummaryField label="מבצע" value={detailFor.importedBy} />
                <SummaryField label="שם קובץ" value={detailFor.fileName} />
                <SummaryField label={'סה"כ שורות'} value={String(detailFor.rowsProcessed)} />
                <SummaryField label="נציגים עודכנו" value={String(detailFor.rowsUpdated)} />
                <SummaryField label="נציגים חדשים" value={String(detailFor.rowsCreated)} />
                <SummaryField label="שורות דולגו" value={String(detailFor.rowsSkipped)} />
                <SummaryField label="סטטוס" value={detailFor.status === "success" ? "הושלם" : detailFor.status === "partial" ? "חלקי" : "נכשל"} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-[color:var(--warning)]/5 p-3">
                  <div className="text-xs font-semibold text-warning-foreground">אזהרות</div>
                  <div className="mt-1 text-2xl font-bold text-warning-foreground">{detailFor.warnings}</div>
                </div>
                <div className="rounded-lg border bg-destructive/5 p-3">
                  <div className="text-xs font-semibold text-destructive">שגיאות</div>
                  <div className="mt-1 text-2xl font-bold text-destructive">{detailFor.errors}</div>
                </div>
              </div>
              {detailFor.errorReport && detailFor.errorReport.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">פירוט אזהרות ושגיאות</div>
                  <ul className="space-y-2">
                    {detailFor.errorReport.slice(0, 50).map((r, k) => (
                      <li key={k} className="rounded border p-2">
                        <div className="font-medium">שורה {r.row}{r.name ? ` – ${r.name}` : ""}</div>
                        <ul className="mt-1 list-disc ps-5 text-muted-foreground">
                          {r.messages.map((m, j) => <li key={j}>{m}</li>)}
                        </ul>
                      </li>
                    ))}
                  </ul>
                  {detailFor.errorReport.length > 50 && (
                    <div className="mt-2 text-xs text-muted-foreground">מוצגות 50 מתוך {detailFor.errorReport.length}. להורדת הכל השתמשו בכפתור הדוח.</div>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {detailFor && (detailFor.errorReport?.length ?? 0) > 0 && (
              <Button variant="outline" onClick={() => setErrFor(detailFor)}>רק שגיאות ואזהרות</Button>
            )}
            {detailFor && <Button variant="outline" onClick={() => downloadErrorReport(detailFor)}>הורדת דוח CSV</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!errFor} onOpenChange={(o) => !o && setErrFor(null)}>
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          <DialogHeader><DialogTitle>שגיאות ואזהרות – {errFor?.fileName}</DialogTitle></DialogHeader>
          {(!errFor?.errorReport || errFor.errorReport.length === 0) ? (
            <div className="text-sm text-muted-foreground">אין שגיאות מתועדות לייבוא זה.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {errFor.errorReport.map((r, k) => (
                <li key={k} className="rounded border p-2">
                  <div className="font-medium">שורה {r.row} {r.name && `– ${r.name}`}</div>
                  <ul className="mt-1 list-disc ps-5 text-muted-foreground">
                    {r.messages.map((m, j) => <li key={j}>{m}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            {errFor && <Button variant="outline" onClick={() => downloadErrorReport(errFor)}>הורדת דוח שגיאות</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>

  );
}

function downloadErrorReport(h: ImportHistoryEntry) {
  const lines = [["שורה", "שם", "הודעה"]];
  for (const r of h.errorReport ?? []) {
    for (const m of r.messages) lines.push([String(r.row), r.name ?? "", m]);
  }
  const csv = Papa.unparse(lines);
  triggerDownload(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }), `import-errors-${h.id}.csv`);
}

// ---------- Manual Entry ----------

function ManualEntryDialog() {
  const { state, updateRep, addRep } = useApp();
  const { isDemo } = useAppMode();
  const { teams: cloudTeams } = useCloudTeams();
  const demoTeams = useMemo(() => teamsFromReps(state.reps).map((t) => ({ id: t.teamId, name: t.teamName })), [state.reps]);
  const teamOptions = isDemo ? demoTeams : cloudTeams;
  const createRepFn = useServerFn(createRepresentative);
  const updateMetricsFn = useServerFn(updateRepresentativeMetrics);
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"update" | "create">("update");
  const [repId, setRepId] = useState<string>(state.reps[0]?.id ?? "");
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState<string>("");
  const [current, setCurrent] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const c = Number(current);
    if (mode === "create") {
      if (!name.trim() || !isFinite(c) || c < 0) {
        toast.error("נא למלא את כל השדות בערכים תקינים"); return;
      }
    } else if (!repId) {
      toast.error("בחר נציג"); return;
    }

    setBusy(true);
    try {
      if (isDemo) {
        if (mode === "create") {
          const teamName = teamOptions.find((tm) => tm.id === teamId)?.name ?? "ללא צוות";
          // Target-setting lives exclusively on /targets — a manually
          // entered rep here always starts with no legacy target.
          addRep({ name: name.trim(), teamId: teamId || null, teamName, monthlyTarget: 0, currentResult: c, lastUpdatedAt: new Date().toISOString().slice(0, 10) });
        } else {
          const patch: Partial<Rep> = { lastUpdatedAt: new Date().toISOString().slice(0, 10) };
          if (current !== "" && isFinite(c) && c >= 0) patch.currentResult = c;
          updateRep(repId, patch);
        }
        toast.success(mode === "create" ? "הנציג נוסף בהצלחה (מצב הדגמה)" : "הנציג עודכן בהצלחה (מצב הדגמה)");
      } else {
        if (mode === "create") {
          await createRepFn({ data: { name: name.trim(), team_id: teamId || null, current_result: c, external_ref: null, user_id: null, active: true } });
        } else {
          const payload: { rep_id: string; current_result?: number } = { rep_id: repId };
          if (current !== "" && isFinite(c) && c >= 0) payload.current_result = c;
          await updateMetricsFn({ data: payload });
        }
        void qc.invalidateQueries({ queryKey: ["representatives"] });
        toast.success(mode === "create" ? "הנציג נוסף ונשמר בענן" : "הנציג עודכן ונשמר בענן");
      }
      setOpen(false);
      setName(""); setCurrent("");
    } catch (e) {
      toast.error("השמירה נכשלה", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><UserPlus className="me-1 h-4 w-4" /> הזנה ידנית</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>הזנה ידנית של ביצועי נציג</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={mode === "update" ? "default" : "outline"} onClick={() => setMode("update")}>עדכון קיים</Button>
            <Button size="sm" variant={mode === "create" ? "default" : "outline"} onClick={() => setMode("create")}>הוספת נציג</Button>
          </div>
          {mode === "update" ? (
            <div className="space-y-1">
              <Label>בחירת נציג</Label>
              <Select value={repId} onValueChange={setRepId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {state.reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name} · {r.teamName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label>שם הנציג</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </div>
              <div className="space-y-1">
                <Label>צוות</Label>
                <Select value={teamId || "__none__"} onValueChange={(v) => setTeamId(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">ללא צוות</SelectItem>
                    {teamOptions.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="space-y-1"><Label>ביצוע נוכחי</Label><Input inputMode="numeric" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">הגדרת יעד חודשי אישי מתבצעת במסך ניהול היעדים הייעודי.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>ביטול</Button>
          <Button onClick={submit} disabled={busy}>שמירה</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Small UI helpers ----------

function StatChip({ label, value, tone }: { label: string; value: number; tone: "muted" | "success" | "info" | "warning" | "danger" }) {
  const toneClass = {
    muted: "bg-muted text-muted-foreground",
    success: "bg-[color:var(--success)]/15 text-success-foreground",
    info: "bg-accent text-accent-foreground",
    warning: "bg-[color:var(--warning)]/15 text-warning-foreground",
    danger: "bg-destructive/10 text-destructive",
  }[tone];
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 inline-flex items-center rounded-md px-2 py-0.5 text-lg font-semibold", toneClass)}>{value}</div>
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

