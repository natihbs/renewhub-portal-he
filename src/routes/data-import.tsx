import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { z } from "zod";
import { toast } from "sonner";
import {
  Upload, FileSpreadsheet, Download, ArrowRight, ArrowLeft, ShieldAlert,
  CheckCircle2, AlertTriangle, XCircle, History, Undo2, FileDown, UserPlus, Pencil,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useIsManager, useApp } from "@/lib/store";
import {
  useImport, autoMap, normalizeName, parseTeam, parseNumber, parseDate,
  detectPii, PII_LABEL, type PiiHit,
  FIELD_LABEL, REQUIRED_FIELDS, type ImportFieldKey, type ImportHistoryEntry,
} from "@/lib/import-store";

import { TEAM_LABEL, type Rep } from "@/lib/seed";
import { formatDateIL } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/data-import")({
  head: () => ({
    meta: [
      { title: "ייבוא נתונים · RenewHub" },
      { name: "description", content: "העלאת דוחות ביצועים יומיים ועדכון הדשבורד" },
      { property: "og:title", content: "ייבוא נתונים · RenewHub" },
      { property: "og:description", content: "העלאת דוחות ביצועים יומיים ועדכון הדשבורד" },
    ],
  }),
  component: DataImportPage,
});

type RawRow = Record<string, unknown>;

type Severity = "error" | "warning";
type RowIssue = { severity: Severity; message: string };

type ResolvedAction = "update" | "create" | "skip";

type ProcessedRow = {
  index: number;
  raw: RawRow;
  name: string;
  team: "car" | "home" | null;
  monthlyTarget: number | null;
  currentResult: number | null;
  updatedAt: string | null;
  issues: RowIssue[];
  matchRepId: string | null;
  action: ResolvedAction;
};

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
    ["דנה כהן", "חידושי רכב", 120, 84, formatDateIL(new Date())],
    ["איתי לוי", "חידושי דירה", 90, 71, formatDateIL(new Date())],
    ["מיה שטרן", "חידושי רכב", 110, 45, formatDateIL(new Date())],
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

// zod schema for validation (per-row)
const rowSchema = z.object({
  name: z.string().trim().min(1, "שם הנציג חסר").max(80, "שם ארוך מדי"),
  team: z.enum(["car", "home"], { message: "צוות חייב להיות 'חידושי רכב' או 'חידושי דירה'" }),
  monthlyTarget: z.number({ message: "יעד חודשי חייב להיות מספר" }).positive("יעד חייב להיות חיובי"),
  currentResult: z.number({ message: "ביצוע נוכחי חייב להיות מספר" }).min(0, "ביצוע לא יכול להיות שלילי"),
  updatedAt: z.string().min(1, "תאריך עדכון לא תקין"),
});

function processRows(rows: RawRow[], mapping: Record<string, ImportFieldKey>, reps: Rep[]): ProcessedRow[] {
  // reverse mapping: field -> column
  const fieldToCol: Partial<Record<ImportFieldKey, string>> = {};
  for (const [col, field] of Object.entries(mapping)) {
    if (field !== "__skip__" && !fieldToCol[field]) fieldToCol[field] = col;
  }
  const repByNorm = new Map<string, Rep>();
  reps.forEach((r) => repByNorm.set(normalizeName(r.name), r));

  const seenNames = new Map<string, number>();
  const out: ProcessedRow[] = [];

  rows.forEach((raw, i) => {
    const issues: RowIssue[] = [];
    const rawName = fieldToCol.name ? String(raw[fieldToCol.name] ?? "").trim() : "";
    const team = fieldToCol.team ? parseTeam(raw[fieldToCol.team]) : null;
    const target = fieldToCol.monthlyTarget ? parseNumber(raw[fieldToCol.monthlyTarget]) : null;
    const current = fieldToCol.currentResult ? parseNumber(raw[fieldToCol.currentResult]) : null;
    const upd = fieldToCol.updatedAt ? parseDate(raw[fieldToCol.updatedAt]) : null;

    const check = rowSchema.safeParse({
      name: rawName, team: team ?? undefined,
      monthlyTarget: target ?? undefined, currentResult: current ?? undefined,
      updatedAt: upd ?? undefined,
    });
    if (!check.success) {
      for (const err of check.error.issues) {
        issues.push({ severity: "error", message: err.message });
      }
    }
    // optional percentage-like fields
    const latePct = fieldToCol.latePct ? parseNumber(raw[fieldToCol.latePct]) : null;
    const upgradePct = fieldToCol.upgradePct ? parseNumber(raw[fieldToCol.upgradePct]) : null;
    for (const [label, v] of [["איחורים", latePct], ["אחוז שדרוגים", upgradePct]] as const) {
      if (v != null && (v < 0 || v > 100)) {
        issues.push({ severity: "warning", message: `${label} מחוץ לטווח 0–100` });
      }
    }

    // duplicate detection
    if (rawName) {
      const key = normalizeName(rawName);
      if (seenNames.has(key)) {
        issues.push({ severity: "warning", message: `כפילות – מופיע גם בשורה ${seenNames.get(key)! + 1}` });
      } else seenNames.set(key, i);
    }

    const match = rawName ? repByNorm.get(normalizeName(rawName)) : undefined;
    const hasErrors = issues.some((x) => x.severity === "error");
    out.push({
      index: i, raw, name: rawName, team, monthlyTarget: target, currentResult: current, updatedAt: upd,
      issues,
      matchRepId: match?.id ?? null,
      action: hasErrors ? "skip" : match ? "update" : "create",
    });
  });
  return out;
}

function DataImportPage() {
  const isManager = useIsManager();
  const { state, updateRep, addRep, replaceReps } = useApp();
  const importStore = useImport();

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, ImportFieldKey>>({});
  const [processed, setProcessed] = useState<ProcessedRow[]>([]);
  const [busy, setBusy] = useState(false);
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
    setProcessed(processRows(rows, mapping, state.reps));
    setStep(2);
  }

  function applyImport() {
    setBusy(true);
    try {
      const snapshot = state.reps.map((r) => ({ ...r }));
      const errorReport: ImportHistoryEntry["errorReport"] = [];
      let updated = 0, created = 0, skipped = 0, warns = 0, errs = 0;

      // Aggregate: last row per rep wins.
      const finalReps = [...state.reps];
      const byId = new Map(finalReps.map((r) => [r.id, r] as const));
      const now = new Date().toISOString().slice(0, 10);

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
        if (r.action === "update" && r.matchRepId) {
          const existing = byId.get(r.matchRepId);
          if (existing) {
            const patched: Rep = {
              ...existing,
              monthlyTarget: r.monthlyTarget ?? existing.monthlyTarget,
              currentResult: r.currentResult ?? existing.currentResult,
              team: r.team ?? existing.team,
              lastUpdatedAt: updatedAt,
            };
            byId.set(existing.id, patched);
            updateRep(existing.id, patched);
            updated++;
          }
        } else if (r.action === "create") {
          addRep({
            name: r.name, team: r.team!, monthlyTarget: r.monthlyTarget!, currentResult: r.currentResult!,
            lastUpdatedAt: updatedAt,
          });
          created++;
        }
      }

      const entry = importStore.pushHistory({
        fileName: file?.name ?? "unknown",
        importedBy: "מנהל",
        rowsProcessed: processed.length,
        rowsUpdated: updated,
        rowsCreated: created,
        rowsSkipped: skipped,
        warnings: warns,
        errors: errs,
        status: errs > 0 ? "partial" : "success",
        snapshot,
        errorReport,
      });
      setLastSummary(entry);
      setStep(4);
      toast.success("הייבוא הושלם", { description: `${updated} עודכנו, ${created} נוספו, ${skipped} דולגו` });
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
            />
          )}
          {step === 4 && lastSummary && (
            <SummaryStep entry={lastSummary} onNew={resetWizard} />
          )}
        </CardContent>
      </Card>

      <HistoryCard
        history={importStore.history}
        onUndo={(entry) => {
          if (!entry.snapshot) { toast.error("לא ניתן לשחזר – אין תמונת מצב שמורה"); return; }
          replaceReps(entry.snapshot);
          importStore.removeHistory(entry.id);
          toast.success("הייבוא האחרון בוטל והנתונים שוחזרו");
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
            RenewHub מיועדת לניהול ביצועים בלבד. יש להסיר את העמודות הרגישות מהקובץ ולנסות שוב.
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
                          disabled={f !== "__skip__" && f !== mapping[h] && usedFields.has(f)}>
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
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatChip label="שורות" value={processed.length} tone="muted" />
        <StatChip label="להתעדכן" value={processed.filter((p) => p.action === "update").length} tone="success" />
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
              <TableHead>יעד</TableHead>
              <TableHead>ביצוע</TableHead>
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
                  <TableCell>{r.team ? TEAM_LABEL[r.team] : <span className="text-destructive">לא מזוהה</span>}</TableCell>
                  <TableCell>{r.monthlyTarget ?? "—"}</TableCell>
                  <TableCell>{r.currentResult ?? "—"}</TableCell>
                  <TableCell>{r.updatedAt ?? <span className="text-destructive">—</span>}</TableCell>
                  <TableCell className="space-y-1">
                    {r.issues.length === 0 ? (
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">תקין</Badge>
                    ) : r.issues.map((i, k) => (
                      <div key={k} className={cn("text-xs", i.severity === "error" ? "text-destructive" : "text-amber-700")}>
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
              <span className="text-xs text-muted-foreground">{TEAM_LABEL[r.team]}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="p-4 text-center text-sm text-muted-foreground">לא נמצאו נציגים</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Step: Confirm ----------

function ConfirmStep({ processed, fileName, criticalCount, warnCount, onBack, onConfirm, busy }: {
  processed: ProcessedRow[]; fileName: string; criticalCount: number; warnCount: number;
  onBack: () => void; onConfirm: () => void; busy: boolean;
}) {
  const updateN = processed.filter((p) => p.action === "update").length;
  const createN = processed.filter((p) => p.action === "create").length;
  const skipN = processed.length - updateN - createN;
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
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={busy}><ArrowRight className="me-1 h-4 w-4" /> חזרה</Button>
        <Button onClick={onConfirm} disabled={busy || updateN + createN === 0}>אישור וייבוא</Button>
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
                          ? <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">{h.warnings}</Badge>
                          : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell>
                        {h.errors > 0
                          ? <Badge variant="destructive">{h.errors}</Badge>
                          : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={h.status === "success" ? "secondary" : h.status === "partial" ? "outline" : "destructive"}
                          className={h.status === "success" ? "bg-emerald-100 text-emerald-800" : ""}>
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
                <div className="rounded-lg border bg-amber-50 p-3">
                  <div className="text-xs font-semibold text-amber-800">אזהרות</div>
                  <div className="mt-1 text-2xl font-bold text-amber-900">{detailFor.warnings}</div>
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
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"update" | "create">("update");
  const [repId, setRepId] = useState<string>(state.reps[0]?.id ?? "");
  const [name, setName] = useState("");
  const [team, setTeam] = useState<"car" | "home">("car");
  const [target, setTarget] = useState<string>("");
  const [current, setCurrent] = useState<string>("");

  function submit() {
    const t = Number(target), c = Number(current);
    if (mode === "create") {
      if (!name.trim() || !isFinite(t) || t <= 0 || !isFinite(c) || c < 0) {
        toast.error("נא למלא את כל השדות בערכים תקינים"); return;
      }
      addRep({ name: name.trim(), team, monthlyTarget: t, currentResult: c, lastUpdatedAt: new Date().toISOString().slice(0, 10) });
      toast.success("הנציג נוסף בהצלחה");
    } else {
      if (!repId) { toast.error("בחר נציג"); return; }
      const patch: Partial<Rep> = { lastUpdatedAt: new Date().toISOString().slice(0, 10) };
      if (target !== "" && isFinite(t) && t > 0) patch.monthlyTarget = t;
      if (current !== "" && isFinite(c) && c >= 0) patch.currentResult = c;
      updateRep(repId, patch);
      toast.success("הנציג עודכן בהצלחה");
    }
    setOpen(false);
    setName(""); setTarget(""); setCurrent("");
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
                  {state.reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name} · {TEAM_LABEL[r.team]}</SelectItem>)}
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
                <Select value={team} onValueChange={(v) => setTeam(v as "car" | "home")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="car">חידושי רכב</SelectItem>
                    <SelectItem value="home">חידושי דירה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>יעד חודשי</Label><Input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
            <div className="space-y-1"><Label>ביצוע נוכחי</Label><Input inputMode="numeric" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
          <Button onClick={submit}>שמירה</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Small UI helpers ----------

function StatChip({ label, value, tone }: { label: string; value: number; tone: "muted" | "success" | "info" | "warning" | "danger" }) {
  const toneClass = {
    muted: "bg-muted text-muted-foreground",
    success: "bg-emerald-100 text-emerald-800",
    info: "bg-sky-100 text-sky-800",
    warning: "bg-amber-100 text-amber-800",
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

