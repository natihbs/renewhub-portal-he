import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  MessageSquare, Sunrise, Moon, Trophy, PartyPopper, Target, Headphones,
  Copy, Save, RefreshCw, Pencil, Trash2, Files, ShieldAlert, MessageCircle,
  Mail, Megaphone, Sparkles,
} from "lucide-react";
import { useApp, useIsManager, teamSummary, competitionLeaderboard } from "@/lib/store";
import { TEAM_LABEL } from "@/lib/seed";
import { formatDateIL, formatNum, formatPct, workdaysRemaining } from "@/lib/format";
import { useComms, KIND_LABEL, type CommsKind, type CommsMessage } from "@/lib/comms-store";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/communications")({
  head: () => ({
    meta: [
      { title: "מרכז תקשורת · RenewHub" },
      { name: "description", content: "יצירה אוטומטית של הודעות ניהוליות - עדכוני בוקר, סיכומי ערב, תחרויות, ברכות ומשוב" },
      { property: "og:title", content: "מרכז תקשורת · RenewHub" },
      { property: "og:description", content: "יצירה אוטומטית של הודעות ניהוליות מבוססות נתוני הדשבורד" },
    ],
  }),
  component: CommsPage,
});

const KIND_ICON: Record<CommsKind, typeof Sunrise> = {
  morning: Sunrise,
  evening: Moon,
  competition: Trophy,
  congrats: PartyPopper,
  coaching: Target,
  listening: Headphones,
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "בוקר טוב לכולם";
  if (h < 17) return "צהריים טובים";
  return "ערב טוב";
}

function CommsPage() {
  const isManager = useIsManager();
  if (!isManager) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={ShieldAlert}
            title="אזור למנהלים בלבד"
            description="מרכז התקשורת זמין לתפקידי ניהול. עברו לתפקיד מנהל דרך התפריט העליון."
          />
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="מרכז תקשורת"
        description="יצירה אוטומטית של תקשורת ניהולית מבוססת נתוני הדשבורד - עדכונים, ברכות ומשוב מוכנים לשליחה"
        actions={<Badge variant="secondary" className="gap-1"><Sparkles className="h-3.5 w-3.5" /> מבוסס תבניות חכמות</Badge>}
      />

      <Tabs defaultValue="generate" dir="rtl">
        <TabsList>
          <TabsTrigger value="generate"><MessageSquare className="ms-1 h-4 w-4" /> יצירת הודעה</TabsTrigger>
          <TabsTrigger value="templates"><Save className="ms-1 h-4 w-4" /> תבניות</TabsTrigger>
          <TabsTrigger value="history"><Files className="ms-1 h-4 w-4" /> היסטוריה</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="mt-4">
          <Generator />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <TemplatesPanel />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- Generators ----------

function useGenerationInputs() {
  const { state } = useApp();
  return useMemo(() => {
    const reps = state.reps;
    const car = teamSummary(reps, "car");
    const home = teamSummary(reps, "home");
    const totalTarget = car.target + home.target;
    const totalResult = car.result + home.result;
    const overall = totalTarget > 0 ? (totalResult / totalTarget) * 100 : 0;

    const withPct = reps.map((r) => ({
      ...r,
      pct: r.monthlyTarget > 0 ? (r.currentResult / r.monthlyTarget) * 100 : 0,
    }));
    const above = withPct.filter((r) => r.pct >= 100).sort((a, b) => b.pct - a.pct);
    const below = withPct.filter((r) => r.pct < 80).sort((a, b) => a.pct - b.pct);
    const onPace = withPct.filter((r) => r.pct >= 80 && r.pct < 100);
    const top = [...withPct].sort((a, b) => b.pct - a.pct).slice(0, 3);

    const activeComp = state.competitions.find((c) => c.active);
    const board = activeComp ? competitionLeaderboard(activeComp) : [];
    const leaderboard = board.slice(0, 5).map((b) => {
      const rep = reps.find((r) => r.id === b.repId);
      return { name: rep?.name ?? "-", team: rep?.team, total: b.total };
    });

    const listeningsThisWeek = state.feedback.slice(0, 20);

    return {
      reps: withPct,
      car, home, overall, totalResult, totalTarget,
      above, below, onPace, top,
      activeComp, leaderboard,
      listeningsThisWeek,
      workdaysLeft: workdaysRemaining(),
    };
  }, [state]);
}

function Generator() {
  const [kind, setKind] = useState<CommsKind>("morning");
  const inputs = useGenerationInputs();
  const [seed, setSeed] = useState(0);
  const [selectedRepId, setSelectedRepId] = useState<string>(inputs.reps[0]?.id ?? "");
  const [listeningId, setListeningId] = useState<string>(inputs.listeningsThisWeek[0]?.id ?? "");

  const generated = useMemo(() => {
    switch (kind) {
      case "morning": return generateMorning(inputs);
      case "evening": return generateEvening(inputs);
      case "competition": return generateCompetition(inputs, seed);
      case "congrats": return generateCongrats(inputs, selectedRepId);
      case "coaching": return generateCoaching(inputs, selectedRepId);
      case "listening": return generateListening(inputs, listeningId);
    }
  }, [kind, inputs, seed, selectedRepId, listeningId]);

  const [body, setBody] = useState(generated.body);
  const [title, setTitle] = useState(generated.title);
  const [dirty, setDirty] = useState(false);

  // Sync when generation changes and user hasn't edited
  useMemo(() => {
    if (!dirty) {
      setBody(generated.body);
      setTitle(generated.title);
    }
  }, [generated, dirty]);

  const { saveMessage, saveTemplate } = useComms();
  const [tplName, setTplName] = useState("");
  const [tplOpen, setTplOpen] = useState(false);

  const regenerate = () => {
    setSeed((s) => s + 1);
    setDirty(false);
    toast.success("נוצרה גרסה חדשה");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      toast.success("הועתק ללוח");
    } catch { toast.error("העתקה נכשלה"); }
  };

  const save = () => {
    saveMessage({ kind, title, body });
    toast.success("נשמר בהיסטוריה");
  };

  const needsRep = kind === "congrats" || kind === "coaching";
  const needsListening = kind === "listening";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Editor column */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">בחירת סוג הודעה</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(Object.keys(KIND_LABEL) as CommsKind[]).map((k) => {
                const Icon = KIND_ICON[k];
                const active = k === kind;
                return (
                  <button
                    key={k}
                    onClick={() => { setKind(k); setDirty(false); }}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border p-3 text-sm text-start transition-colors",
                      active
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                    <span className="font-medium">{KIND_LABEL[k]}</span>
                  </button>
                );
              })}
            </div>

            {(needsRep || needsListening) && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {needsRep && (
                  <div>
                    <Label className="mb-1.5 block text-xs">בחירת נציג</Label>
                    <Select value={selectedRepId} onValueChange={(v) => { setSelectedRepId(v); setDirty(false); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {inputs.reps.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name} · {TEAM_LABEL[r.team]} · {formatPct(r.pct)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {needsListening && (
                  <div>
                    <Label className="mb-1.5 block text-xs">בחירת האזנה</Label>
                    <Select value={listeningId} onValueChange={(v) => { setListeningId(v); setDirty(false); }}>
                      <SelectTrigger><SelectValue placeholder="בחר האזנה" /></SelectTrigger>
                      <SelectContent>
                        {inputs.listeningsThisWeek.map((f) => {
                          const rep = inputs.reps.find((r) => r.id === f.repId);
                          return (
                            <SelectItem key={f.id} value={f.id}>
                              {rep?.name ?? "-"} · {formatDateIL(f.date)} · {f.score}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">עריכה</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={regenerate}>
                <RefreshCw className="ms-1 h-4 w-4" /> צור שוב
              </Button>
              <Dialog open={tplOpen} onOpenChange={setTplOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm"><Save className="ms-1 h-4 w-4" /> שמור כתבנית</Button>
                </DialogTrigger>
                <DialogContent dir="rtl">
                  <DialogHeader><DialogTitle>שמירת תבנית</DialogTitle></DialogHeader>
                  <div className="space-y-2">
                    <Label>שם התבנית</Label>
                    <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder={`תבנית ${KIND_LABEL[kind]}`} />
                    <p className="text-xs text-muted-foreground">
                      התבנית תישמר בקטגוריה <b>{KIND_LABEL[kind]}</b> ותכיל את תוכן ההודעה הנוכחי.
                    </p>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setTplOpen(false)}>ביטול</Button>
                    <Button onClick={() => {
                      if (!tplName.trim()) { toast.error("נדרש שם"); return; }
                      saveTemplate({ kind, name: tplName.trim(), body });
                      setTplName(""); setTplOpen(false);
                      toast.success("התבנית נשמרה");
                    }}>שמור</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Button size="sm" onClick={save}><Save className="ms-1 h-4 w-4" /> שמור בהיסטוריה</Button>
              <Button size="sm" variant="secondary" onClick={copy}><Copy className="ms-1 h-4 w-4" /> העתק</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="mb-1.5 block text-xs">כותרת</Label>
              <Input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">תוכן</Label>
              <Textarea
                value={body}
                onChange={(e) => { setBody(e.target.value); setDirty(true); }}
                rows={18}
                className="font-medium leading-relaxed text-[15px]"
                dir="rtl"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {body.length} תווים · תמיכה במשתנים דוגמת {"{{name}}"}, {"{{pct}}"}, {"{{team}}"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Previews column */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">תצוגה מקדימה</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="whatsapp" dir="rtl">
              <TabsList>
                <TabsTrigger value="whatsapp"><MessageCircle className="ms-1 h-4 w-4" /> וואטסאפ</TabsTrigger>
                <TabsTrigger value="email"><Mail className="ms-1 h-4 w-4" /> אימייל</TabsTrigger>
                <TabsTrigger value="internal"><Megaphone className="ms-1 h-4 w-4" /> הודעה פנימית</TabsTrigger>
              </TabsList>
              <TabsContent value="whatsapp" className="mt-3">
                <WhatsAppPreview body={body} />
              </TabsContent>
              <TabsContent value="email" className="mt-3">
                <EmailPreview title={title} body={body} />
              </TabsContent>
              <TabsContent value="internal" className="mt-3">
                <InternalPreview title={title} body={body} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------- Preview components ----------

function WhatsAppPreview({ body }: { body: string }) {
  return (
    <div className="rounded-xl bg-[#e8f0e6] p-4">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-3 shadow-soft">
        <div className="mb-2 text-[11px] font-semibold text-emerald-700">RenewHub · צוות ניהול</div>
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
          {body}
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground text-end">
          {new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })} ✓✓
        </div>
      </div>
    </div>
  );
}

function EmailPreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b p-3 text-sm">
        <div><span className="text-muted-foreground">מאת: </span>ניהול RenewHub</div>
        <div><span className="text-muted-foreground">אל: </span>צוות חידושים</div>
        <div><span className="text-muted-foreground">נושא: </span><b>{title}</b></div>
      </div>
      <div className="whitespace-pre-wrap p-4 text-[14px] leading-relaxed">{body}</div>
    </div>
  );
}

function InternalPreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
        <Megaphone className="h-4 w-4" /> הודעה פנימית · לוח המודעות
      </div>
      <h3 className="text-lg font-bold">{title}</h3>
      <div className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed">{body}</div>
    </div>
  );
}

// ---------- Templates panel ----------

function TemplatesPanel() {
  const { templates, removeTemplate } = useComms();
  const grouped = useMemo(() => {
    const g: Record<CommsKind, typeof templates> = {
      morning: [], evening: [], competition: [], congrats: [], coaching: [], listening: [],
    };
    for (const t of templates) g[t.kind].push(t);
    return g;
  }, [templates]);

  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={Save}
            title="אין תבניות שמורות"
            description="כשתשמרו הודעה כתבנית, היא תופיע כאן ותהיה זמינה בקטגוריה המתאימה."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(Object.keys(KIND_LABEL) as CommsKind[]).map((k) => {
        const list = grouped[k];
        if (list.length === 0) return null;
        const Icon = KIND_ICON[k];
        return (
          <Card key={k}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon className="h-4 w-4 text-primary" /> {KIND_LABEL[k]}
                <Badge variant="secondary" className="ms-1">{list.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {list.map((t) => (
                <div key={t.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{t.name}</div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost" size="icon"
                        onClick={async () => { await navigator.clipboard.writeText(t.body); toast.success("הועתק"); }}
                        aria-label="העתק"
                      ><Copy className="h-4 w-4" /></Button>
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => { removeTemplate(t.id); toast.success("נמחק"); }}
                        aria-label="מחק"
                      ><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---------- History panel ----------

function HistoryPanel() {
  const { history, removeMessage, duplicateMessage, updateMessage } = useComms();
  const [editing, setEditing] = useState<CommsMessage | null>(null);

  if (history.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={Files}
            title="אין הודעות בהיסטוריה"
            description="הודעות שתפיקו במרכז התקשורת יישמרו כאן להעתקה מהירה או שכפול."
            action={<Link to="/communications"><Button>יצירת הודעה חדשה</Button></Link>}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {history.map((m) => {
          const Icon = KIND_ICON[m.kind];
          return (
            <Card key={m.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" /> {KIND_LABEL[m.kind]} · {formatDateIL(m.createdAt)}
                    </div>
                    <CardTitle className="mt-1 truncate text-base">{m.title}</CardTitle>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={async () => { await navigator.clipboard.writeText(m.body); toast.success("הועתק"); }} aria-label="העתק"><Copy className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setEditing(m)} aria-label="עריכה"><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { duplicateMessage(m.id); toast.success("שוכפל"); }} aria-label="שכפל"><Files className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { removeMessage(m.id); toast.success("נמחק"); }} aria-label="מחק"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">{m.body}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader><DialogTitle>עריכת הודעה</DialogTitle></DialogHeader>
          {editing && (
            <EditForm
              msg={editing}
              onSave={(patch) => { updateMessage(editing.id, patch); setEditing(null); toast.success("עודכן"); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditForm({ msg, onSave }: { msg: CommsMessage; onSave: (p: { title: string; body: string }) => void }) {
  const [title, setTitle] = useState(msg.title);
  const [body, setBody] = useState(msg.body);
  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-1.5 block text-xs">כותרת</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label className="mb-1.5 block text-xs">תוכן</Label>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} dir="rtl" />
      </div>
      <DialogFooter>
        <Button onClick={() => onSave({ title, body })}>שמור שינויים</Button>
      </DialogFooter>
    </div>
  );
}

// ---------- Deterministic generators ----------

type Inputs = ReturnType<typeof useGenerationInputs>;

function generateMorning(i: Inputs): { title: string; body: string } {
  const date = formatDateIL(new Date());
  const lines: string[] = [];
  lines.push(`${greeting()} ☀️`);
  lines.push(`עדכון בוקר · ${date}`);
  lines.push("");
  lines.push(`אחוז חידושים כללי: ${formatPct(i.overall)} (${formatNum(i.totalResult)} מתוך ${formatNum(i.totalTarget)})`);
  lines.push(`נותרו ${i.workdaysLeft} ימי עבודה בחודש.`);
  lines.push("");
  lines.push(`🚗 ${TEAM_LABEL.car}: ${formatPct(i.car.pct)} · ${formatNum(i.car.result)}/${formatNum(i.car.target)}`);
  lines.push(`🏠 ${TEAM_LABEL.home}: ${formatPct(i.home.pct)} · ${formatNum(i.home.result)}/${formatNum(i.home.target)}`);
  lines.push("");
  if (i.top.length) {
    lines.push("⭐ מובילים כרגע:");
    i.top.forEach((r, idx) => lines.push(`${idx + 1}. ${r.name} - ${formatPct(r.pct)}`));
    lines.push("");
  }
  lines.push("🎯 מיקוד להיום:");
  if (i.below.length > 0) {
    const names = i.below.slice(0, 3).map((r) => r.name).join(", ");
    lines.push(`• ליווי צמוד ל-${names}`);
  }
  lines.push("• סגירת שיחות פתוחות מאתמול לפני 10:00");
  lines.push("• דגש על שדרוגים בשיחות חידוש");
  lines.push("");
  lines.push("בואו נעשה חודש מצוין 💪");
  return { title: `עדכון בוקר · ${date}`, body: lines.join("\n") };
}

function generateEvening(i: Inputs): { title: string; body: string } {
  const date = formatDateIL(new Date());
  const lines: string[] = [];
  lines.push(`סיכום יום · ${date} 🌙`);
  lines.push("");
  lines.push(`סה"כ חידושים החודש: ${formatNum(i.totalResult)} (${formatPct(i.overall)} מהיעד)`);
  lines.push(`🚗 ${TEAM_LABEL.car}: ${formatPct(i.car.pct)} · 🏠 ${TEAM_LABEL.home}: ${formatPct(i.home.pct)}`);
  lines.push("");
  if (i.above.length) {
    lines.push(`🏆 ${i.above.length} נציגים מעל היעד:`);
    i.above.slice(0, 5).forEach((r) => lines.push(`• ${r.name} - ${formatPct(r.pct)}`));
    lines.push("");
  }
  if (i.activeComp && i.leaderboard.length) {
    lines.push(`🎖 תחרות "${i.activeComp.name}" - עדכון:`);
    i.leaderboard.slice(0, 3).forEach((b, idx) => lines.push(`${idx + 1}. ${b.name} - ${formatNum(b.total)} נק'`));
    lines.push("");
  }
  lines.push(`🎧 האזנות שבוצעו השבוע: ${i.listeningsThisWeek.length}`);
  lines.push("");
  lines.push("📌 מיקוד למחר:");
  if (i.below.length > 0) lines.push(`• תמיכה ב-${i.below.slice(0, 2).map((r) => r.name).join(", ")}`);
  lines.push("• מעקב אחר שיחות חוזרות מהיום");
  lines.push("");
  lines.push("תודה על יום מעולה, נתראה מחר 🙏");
  return { title: `סיכום ערב · ${date}`, body: lines.join("\n") };
}

function generateCompetition(i: Inputs, seed: number): { title: string; body: string } {
  const comp = i.activeComp;
  if (!comp) {
    return {
      title: "עדכון תחרות",
      body: "אין תחרות פעילה כרגע. פתחו תחרות חדשה במסך התחרויות כדי להפיק עדכון.",
    };
  }
  const lines: string[] = [];
  lines.push(`🏆 עדכון תחרות · ${comp.name}`);
  lines.push("");
  lines.push("📊 טבלת דירוג:");
  i.leaderboard.forEach((b, idx) => {
    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`;
    lines.push(`${medal} ${b.name} - ${formatNum(b.total)} נק'`);
  });
  lines.push("");
  if (i.leaderboard[0]) {
    lines.push(`✨ מנצח היום: ${i.leaderboard[0].name}`);
  }
  const weekly = i.leaderboard[(seed) % Math.max(i.leaderboard.length, 1)];
  if (weekly) {
    lines.push(`🌟 בולט השבוע: ${weekly.name} - מגמת עלייה עקבית`);
  }
  lines.push("");
  lines.push(`💰 פרס: ${comp.prize}`);
  lines.push(`📅 סיום: ${formatDateIL(comp.endDate)}`);
  lines.push("");
  lines.push("המשיכו לצבור נקודות - הפער ניתן לסגירה 🔥");
  return { title: `עדכון תחרות · ${comp.name}`, body: lines.join("\n") };
}

function generateCongrats(i: Inputs, repId: string): { title: string; body: string } {
  const rep = i.reps.find((r) => r.id === repId);
  if (!rep) return { title: "ברכה אישית", body: "בחרו נציג להפקת ברכה." };
  const lines: string[] = [];
  lines.push(`כל הכבוד ${rep.name}! 🎉`);
  lines.push("");
  if (rep.pct >= 100) {
    lines.push(`עמדת ביעד עם ${formatPct(rep.pct)} - זה הישג משמעותי.`);
    lines.push(`${formatNum(rep.currentResult)} חידושים בצוות ${TEAM_LABEL[rep.team]} מדברים בעד עצמם.`);
  } else if (rep.pct >= 80) {
    lines.push(`אתה בקצב מעולה - ${formatPct(rep.pct)} מהיעד ועדיין נותרו ${i.workdaysLeft} ימי עבודה.`);
    lines.push("ההתמדה שלך ניכרת בכל שיחה.");
  } else {
    lines.push("ראיתי את המאמץ והשיפור שלך בימים האחרונים.");
    lines.push("כל שיחה טובה נספרת - המשך כך.");
  }
  lines.push("");
  lines.push("גאה בך 🙌");
  return { title: `ברכה אישית · ${rep.name}`, body: lines.join("\n") };
}

function generateCoaching(i: Inputs, repId: string): { title: string; body: string } {
  const rep = i.reps.find((r) => r.id === repId);
  if (!rep) return { title: "משוב אימון", body: "בחרו נציג להפקת משוב." };
  const lines: string[] = [];
  lines.push(`היי ${rep.name},`);
  lines.push("");
  // Positive opening
  lines.push(`אני רוצה להתחיל בלהגיד שאני מעריך את הנוכחות והמחויבות שלך בצוות ${TEAM_LABEL[rep.team]}.`);
  lines.push("");
  // Current challenge
  const gap = rep.monthlyTarget - rep.currentResult;
  if (rep.pct < 80) {
    lines.push(`ראיתי בנתונים שאנחנו עומדים על ${formatPct(rep.pct)} מהיעד, ונותרו כ-${formatNum(Math.max(gap, 0))} חידושים למטרה החודשית.`);
  } else {
    lines.push(`אתה נמצא ב-${formatPct(rep.pct)} מהיעד, ויש עוד מרחב לסגור את הפער ולעבור אותו.`);
  }
  lines.push("");
  // Concrete recommendation
  lines.push("הצעה קונקרטית:");
  lines.push("• נזמן פגישה קצרה של 15 דק' לעבור יחד על שיחה או שתיים.");
  lines.push("• נתמקד בשלב טיפול בהתנגדויות ובהצעת שדרוג בסיום.");
  lines.push(`• יעד ביניים: ${Math.ceil(Math.max(gap, 5) / Math.max(i.workdaysLeft, 1))} חידושים ביום ב-${i.workdaysLeft} הימים הקרובים.`);
  lines.push("");
  // Encouragement
  lines.push("אני בטוח שיש לך את הכלים להגיע לשם, ואני כאן לכל שאלה או ליווי.");
  lines.push("");
  lines.push("בהצלחה 💪");
  return { title: `משוב אימון · ${rep.name}`, body: lines.join("\n") };
}

function generateListening(i: Inputs, listeningId: string): { title: string; body: string } {
  const fb = i.listeningsThisWeek.find((f) => f.id === listeningId);
  if (!fb) return { title: "משוב האזנה", body: "בחרו האזנה להפקת סיכום." };
  const rep = i.reps.find((r) => r.id === fb.repId);
  const lines: string[] = [];
  lines.push(`סיכום האזנה · ${rep?.name ?? "-"}`);
  lines.push(`תאריך: ${formatDateIL(fb.date)} · ציון: ${fb.score}/100`);
  lines.push("");
  lines.push("✅ נקודות חוזק:");
  lines.push(`• ${fb.keep || "פתיחה מקצועית והקשבה טובה ללקוח"}`);
  lines.push("");
  lines.push("🔧 נקודות לשיפור:");
  lines.push(`• ${fb.improve || "העמקה בשלב הצגת היתרונות והצעת שדרוג"}`);
  lines.push("");
  lines.push("👣 פעולה הבאה:");
  lines.push(`• ${fb.nextTask || "תרגול תסריט טיפול בהתנגדויות ב-3 שיחות הקרובות"}`);
  lines.push("");
  lines.push("📝 סיכום מנהל:");
  lines.push(fb.managerSummary || "התקדמות טובה, נמשיך לעקוב בשבוע הקרוב.");
  return { title: `משוב האזנה · ${rep?.name ?? ""}`, body: lines.join("\n") };
}
