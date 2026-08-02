import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useApp, useIsManager } from "@/lib/store";
import { useAppMode } from "@/lib/app-mode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Users, UsersRound, BookOpen, Trophy, Sliders, Megaphone, Plus, Pencil, Trash2, ShieldAlert, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { formatDateIL } from "@/lib/format";
import type { Announcement } from "@/lib/seed";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

import { requireRole } from "@/lib/require-role";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: () => requireRole(["admin"]),
  head: () => ({
    meta: [
      { title: "ניהול המערכת · Pulse" },
      { name: "description", content: "עמוד ניהול פנימי למנהלי המערכת" },
      { property: "og:title", content: "ניהול המערכת · Pulse" },
      { property: "og:description", content: "עמוד ניהול פנימי למנהלי המערכת" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const isManager = useIsManager();
  const { state, resetAll } = useApp();
  const { isDemo } = useAppMode();

  if (!isManager) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={ShieldAlert}
            title="אזור למנהלים בלבד"
            description='כדי לצפות בעמוד זה יש להחליף למצב "מנהל" מתפריט הבחירה שבראש המסך.'
          />
        </CardContent>
      </Card>
    );
  }

  const cards = [
    { title: "ניהול נציגים", desc: "הוספה, השבתה ומחיקה של נציגים ויעדים", icon: Users, to: "/representatives" as const },
    { title: "ניהול צוותים", desc: "יצירה, עריכה והשבתה של צוותים", icon: UsersRound, to: "/teams" as const },
    { title: "ניהול תכנים", desc: "הוספה ועריכת מאמרים במרכז הידע", icon: BookOpen, to: "/knowledge" as const },
    { title: "ניהול תחרויות", desc: "יצירה ועריכת תחרויות וקטגוריות", icon: Trophy, to: "/competitions" as const },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="ניהול המערכת"
        description="אזור מרוכז לפעולות ניהול, תכנים ונציגים"
        actions={
          // Development-only utility: resetAll() only does anything in Demo Mode
          // (a no-op in Live Mode — see store.tsx), and Demo Mode itself is only ever
          // reachable in a dev build (see app-mode.tsx). Never rendered in production.
          isDemo ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm"><RotateCcw className="ms-1 h-4 w-4" />איפוס נתוני הדגמה (למפתחים)</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>לאפס לנתוני ההדגמה?</AlertDialogTitle>
                  <AlertDialogDescription>כל השינויים שביצעתם יימחקו ותוצג הגרסה ההתחלתית.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>ביטול</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { resetAll(); toast.success("הנתונים אופסו"); }}>איפוס</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : undefined
        }
      />


      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.title} to={c.to} className="group focus:outline-none">
              <Card className="h-full card-interactive">
                <CardContent className="pt-5">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="mt-3 font-bold">{c.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{c.desc}</div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Scoring settings shortcut */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sliders className="h-4 w-4 text-primary" /> הגדרות ניקוד
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          הגדרות ניקוד לתחרויות מנוהלות בעמוד <Link to="/competitions" className="text-primary font-semibold underline underline-offset-2">תחרויות</Link>. שם ניתן להוסיף קטגוריות עם ניקוד חיובי או שלילי ולעדכן ניקוד ידני לכל נציג.
        </CardContent>
      </Card>

      {/* Announcements management */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4 text-primary" /> הודעות ועדכונים
          </CardTitle>
          <AnnouncementDialog trigger={<Button size="sm"><Plus className="ms-1 h-4 w-4" />הודעה חדשה</Button>} />
        </CardHeader>
        <CardContent>
          {state.announcements.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="עדיין לא פורסמו הודעות"
              description="פרסמו הודעה חדשה כדי לעדכן את הצוות בשינויים ובעדכונים חשובים."
              action={<AnnouncementDialog trigger={<Button size="sm"><Plus className="ms-1 h-4 w-4" />הודעה חדשה</Button>} />}
              compact
            />
          ) : (
            <div className="space-y-2">
              {state.announcements.map((a) => (
                <AnnouncementRow key={a.id} a={a} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AnnouncementRow({ a }: { a: Announcement }) {
  const { removeAnnouncement } = useApp();
  return (
    <div className="flex items-start gap-3 rounded-xl border p-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">{a.title}</div>
          <div className="text-xs text-muted-foreground">{formatDateIL(a.date)}</div>
        </div>
        <p className="text-sm mt-1 text-foreground/80">{a.body}</p>
      </div>
      <div className="flex gap-1">
        <AnnouncementDialog announcement={a} trigger={<Button size="icon" variant="ghost" aria-label={`עריכת ההודעה ${a.title}`}><Pencil className="h-4 w-4" /></Button>} />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" aria-label={`מחיקת ההודעה ${a.title}`}><Trash2 className="h-4 w-4" /></Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>מחיקת הודעה?</AlertDialogTitle>
              <AlertDialogDescription>לא ניתן לשחזר.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction onClick={() => { removeAnnouncement(a.id); toast.success("ההודעה נמחקה"); }}>מחיקה</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function AnnouncementDialog({ trigger, announcement }: { trigger: React.ReactNode; announcement?: Announcement }) {
  const { addAnnouncement, updateAnnouncement } = useApp();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const submit = () => {
    if (!title.trim() || !body.trim()) return toast.error("יש למלא את כל השדות");
    if (announcement) {
      updateAnnouncement(announcement.id, { title, body });
      toast.success("ההודעה עודכנה");
    } else {
      addAnnouncement({ title, body });
      toast.success("ההודעה נוספה");
    }
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{announcement ? "עריכת הודעה" : "הודעה חדשה"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>כותרת</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1"><Label>תוכן</Label><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
          <Button onClick={submit}>{announcement ? "שמירה" : "הוספה"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
