import { useState } from "react";
import { Lightbulb, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIdeas, type Idea } from "@/lib/ideas-store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function IdeaFeedbackButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [category, setCategory] = useState<Idea["category"]>("רעיון");
  const { ideas, addIdea, removeIdea } = useIdeas();

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      toast.error("יש לבדוק את הנתונים שהוזנו", { description: "הרעיון חייב להכיל לפחות 3 תווים." });
      return;
    }
    addIdea({ text: trimmed, category });
    setText("");
    toast.success("נשמר בהצלחה", { description: "הרעיון נשמר מקומית במכשיר." });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-5 start-5 z-40 flex items-center gap-2 rounded-full bg-primary text-primary-foreground",
          "px-4 py-2.5 text-sm font-medium shadow-lg hover:shadow-xl transition-all",
          "hover:scale-105 active:scale-95"
        )}
        aria-label="דווח על רעיון"
      >
        <Lightbulb className="h-4 w-4" />
        <span className="hidden sm:inline">דווח על רעיון</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>דווח על רעיון</DialogTitle>
            <DialogDescription>
              משוב, באגים ורעיונות לשיפור. נשמר מקומית ומיועד למעקב עצמי.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Select value={category} onValueChange={(v) => setCategory(v as Idea["category"])}>
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="רעיון">רעיון</SelectItem>
                  <SelectItem value="שיפור">שיפור</SelectItem>
                  <SelectItem value="באג">באג</SelectItem>
                  <SelectItem value="אחר">אחר</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">{ideas.length} רעיונות שמורים</span>
            </div>

            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="תיאור הרעיון או המשוב..."
              rows={4}
              maxLength={500}
            />
            <div className="text-xs text-muted-foreground text-end">{text.length} / 500</div>

            {ideas.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-lg border divide-y">
                {ideas.map((i) => (
                  <div key={i.id} className="flex items-start gap-2 p-2 text-sm">
                    <span className="inline-flex shrink-0 rounded bg-secondary px-2 py-0.5 text-[11px] font-medium">
                      {i.category}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{i.text}</p>
                      <p className="text-[11px] text-muted-foreground">{new Date(i.date).toLocaleString("he-IL")}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => removeIdea(i.id)}
                      aria-label="מחיקה"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>סגור</Button>
            <Button onClick={submit}>שלח רעיון</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
