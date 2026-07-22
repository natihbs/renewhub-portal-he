import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useApp, useIsManager } from "@/lib/store";
import { ARTICLE_CATEGORIES, type Article, type ArticleCategory } from "@/lib/seed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, Search, Clock, Star, BookOpen } from "lucide-react";
import { formatDateIL } from "@/lib/format";
import { toast } from "sonner";
import { ManagerOnly } from "@/components/ManagerOnly";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "מרכז ידע · RenewHub" },
      { name: "description", content: "מאמרים, תסריטים והדרכות לצוותי החידושים" },
      { property: "og:title", content: "מרכז ידע · RenewHub" },
      { property: "og:description", content: "מאמרים, תסריטים והדרכות לצוותי החידושים" },
    ],
  }),
  component: KnowledgePage,
});

function KnowledgePage() {
  const { state } = useApp();
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>("all");
  const isManager = useIsManager();

  const filtered = useMemo(() => {
    return state.articles.filter((a) => {
      if (cat !== "all" && a.category !== cat) return false;
      if (query && !a.title.includes(query) && !a.summary.includes(query)) return false;
      return true;
    });
  }, [state.articles, query, cat]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="מרכז ידע"
        description="מאמרים, תסריטי שיחה והדרכות לצוותי החידושים"
        actions={
          <ManagerOnly>
            <ArticleFormDialog trigger={<Button><Plus className="ms-1 h-4 w-4" />הוספת מאמר</Button>} />
          </ManagerOnly>
        }
      />

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute inset-y-0 end-2 my-auto h-4 w-4 text-muted-foreground" />
              <Input placeholder="חיפוש לפי כותרת או תקציר…" value={query} onChange={(e) => setQuery(e.target.value)} className="pe-8" />
            </div>
            <Select value={cat} onValueChange={setCat}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הקטגוריות</SelectItem>
                {ARTICLE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={BookOpen}
              title={state.articles.length === 0 ? "מרכז הידע ריק" : "לא נמצאו מאמרים תואמים"}
              description={
                state.articles.length === 0
                  ? "הוסיפו מאמר ראשון - תסריט שיחה, מדריך או מענה לשאלה נפוצה."
                  : "נסו לשנות את החיפוש או לבחור קטגוריה אחרת."
              }
              action={
                state.articles.length === 0 ? (
                  <ManagerOnly>
                    <ArticleFormDialog trigger={<Button><Plus className="ms-1 h-4 w-4" />הוספת מאמר</Button>} />
                  </ManagerOnly>
                ) : (
                  <Button variant="outline" onClick={() => { setQuery(""); setCat("all"); }}>ניקוי סינון</Button>
                )
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((a) => (
            <ArticleCard key={a.id} article={a} isManager={isManager} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleCard({ article, isManager }: { article: Article; isManager: boolean }) {
  const { removeArticle } = useApp();
  const [read, setRead] = useState(false);
  return (
    <Card className="flex flex-col card-interactive">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{article.title}</CardTitle>
          {article.important && <Star className="h-4 w-4 shrink-0 text-yellow-500 fill-yellow-500" />}
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <Badge variant="secondary">{article.category}</Badge>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" /> {article.readMinutes} דק' קריאה
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <p className="text-sm text-foreground/80 flex-1">{article.summary}</p>
        <div className="text-xs text-muted-foreground mt-3">עודכן ב-{formatDateIL(article.updatedAt)}</div>
        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" onClick={() => setRead(true)}>פתיחת מאמר</Button>
          {isManager && (
            <>
              <ArticleFormDialog article={article} trigger={<Button size="icon" variant="ghost"><Pencil className="h-4 w-4" /></Button>} />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="icon" variant="ghost"><Trash2 className="h-4 w-4" /></Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>מחיקת מאמר?</AlertDialogTitle>
                    <AlertDialogDescription>לא ניתן לשחזר לאחר המחיקה.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>ביטול</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { removeArticle(article.id); toast.success("המאמר נמחק"); }}>מחיקה</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </CardContent>
      <Dialog open={read} onOpenChange={setRead}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{article.title}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Badge variant="secondary">{article.category}</Badge>
              {article.important && <Badge className="bg-yellow-500 text-white">חשוב</Badge>}
              <span className="text-xs text-muted-foreground">עודכן ב-{formatDateIL(article.updatedAt)}</span>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{article.body}</p>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ArticleFormDialog({ trigger, article }: { trigger: React.ReactNode; article?: Article }) {
  const { addArticle, updateArticle } = useApp();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(article?.title ?? "");
  const [category, setCategory] = useState<ArticleCategory>(article?.category ?? "ביטוח רכב");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const [readMinutes, setReadMinutes] = useState<number>(article?.readMinutes ?? 3);
  const [important, setImportant] = useState<boolean>(article?.important ?? false);

  const submit = () => {
    if (!title.trim() || !summary.trim() || !body.trim()) return toast.error("יש למלא את כל השדות");
    if (readMinutes < 1) return toast.error("זמן קריאה חייב להיות לפחות דקה");
    if (article) {
      updateArticle(article.id, { title, category, summary, body, readMinutes, important });
      toast.success("המאמר עודכן");
    } else {
      addArticle({ title, category, summary, body, readMinutes, important });
      toast.success("המאמר נוסף");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{article ? "עריכת מאמר" : "הוספת מאמר"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>כותרת</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1"><Label>קטגוריה</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as ArticleCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ARTICLE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>תקציר</Label><Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
          <div className="space-y-1"><Label>תוכן המאמר</Label><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>זמן קריאה (דק')</Label><Input type="number" min={1} value={readMinutes} onChange={(e) => setReadMinutes(Number(e.target.value))} /></div>
            <div className="flex items-center gap-2 pt-6">
              <Checkbox id="imp" checked={important} onCheckedChange={(v) => setImportant(v === true)} />
              <Label htmlFor="imp" className="cursor-pointer">סמן כחשוב</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
          <Button onClick={submit}>{article ? "שמירה" : "הוספה"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
