import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Database } from "lucide-react";
import { formatNum } from "@/lib/format";
import { runManualIngestion } from "@/lib/ingestion.functions";

/**
 * Seeds demo inventory so the operator screen can be shown to somebody.
 *
 * MVP ONLY, and labelled as such on the card itself. The Menora feed is not
 * connected; without this there is nothing for a representative to work and
 * the whole runtime loop is undemonstrable. It drives exactly the same
 * pipeline a scheduled worker will drive, so this is a temporary TRIGGER, not
 * a temporary implementation.
 *
 * REPORTS WHAT ACTUALLY HAPPENED. A rejected import is a normal outcome of a
 * fail-closed pipeline — the previous inventory was protected — so it renders
 * as a distinct, explained state rather than as an error or, worse, as
 * success. The two counts that matter are how many rows arrived and how many
 * changed anything; a run that loads 3,000 rows and changes none is a
 * different event from one that changes 3,000, and they look identical if
 * only the total is shown.
 */
export function DemoSeedCard() {
  const runFn = useServerFn(runManualIngestion);
  const [count, setCount] = useState("3000");

  const mutation = useMutation({
    mutationFn: (itemCount: number) =>
      runFn({
        data: {
          synthetic: { itemCount },
          externalBatchRef: `demo-${new Date().toISOString().slice(0, 19)}`,
        },
      }),
  });

  const parsed = Number.parseInt(count, 10);
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= 200_000;
  const result = mutation.data;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            טעינת נתוני הדגמה
          </CardTitle>
          <Badge variant="outline">לצורכי הדגמה בלבד</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          יוצר ספר חידושים לדוגמה ומשייך אותו לנציגים הפעילים, כדי שאפשר יהיה להדגים את רשימת העבודה
          לפני חיבור המערכת המרכזית. לאחר טעינה מוצלחת הנתונים הנגזרים מתעדכנים אוטומטית.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Label htmlFor="demo-seed-count">כמות פריטים</Label>
            <Input
              id="demo-seed-count"
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              disabled={mutation.isPending}
              className="tabular-nums"
            />
          </div>
          <Button onClick={() => mutation.mutate(parsed)} disabled={!valid || mutation.isPending}>
            {mutation.isPending ? "טוען…" : "טעינת נתוני הדגמה"}
          </Button>
        </div>

        {!valid && count.trim() !== "" && (
          <p className="text-sm text-destructive">יש להזין מספר בין 1 ל־200,000.</p>
        )}

        {mutation.isError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>
              {mutation.error instanceof Error ? mutation.error.message : "הטעינה נכשלה."} הנתונים
              הקודמים נשמרו ללא שינוי.
            </span>
          </div>
        )}

        {result && <SeedResult result={result} />}
      </CardContent>
    </Card>
  );
}

type RunResult = Awaited<ReturnType<typeof runManualIngestion>>;

function SeedResult({ result }: { result: RunResult }) {
  // A rejection is the pipeline working, not failing — the previous data was
  // protected. Shown as its own state so nobody reads it as either.
  if (!result.published) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <div className="font-medium">הטעינה נעצרה לפני עדכון הנתונים</div>
            <p className="text-muted-foreground">
              נבדקו {formatNum(result.rowCount)} שורות. הנתונים הקודמים נשמרו במלואם.
            </p>
            {result.rejectionCode && (
              <p className="text-muted-foreground">סיבה: {rejectionLabel(result.rejectionCode)}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const changed = result.rowsInserted + result.rowsUpdated;
  return (
    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <div className="font-medium">הטעינה הושלמה</div>
          <p className="text-muted-foreground">
            התקבלו {formatNum(result.rowCount)} שורות · נוספו {formatNum(result.rowsInserted)} ·
            עודכנו {formatNum(result.rowsUpdated)} · ללא שינוי {formatNum(result.rowsUnchanged)}
          </p>
          {changed === 0 && (
            <p className="text-muted-foreground">אף פריט לא השתנה — הנתונים כבר היו מעודכנים.</p>
          )}
          {result.coverage.computed ? (
            <p className="text-muted-foreground">
              הנתונים הנגזרים חושבו מחדש ({formatNum(result.coverage.factsWritten)} רשומות).
            </p>
          ) : (
            <p className="text-amber-700 dark:text-amber-400">
              הנתונים נטענו, אך חישוב הנתונים הנגזרים לא הושלם. ייתכן שהסיכומים אינם מעודכנים.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Machine codes are for logs. A person reading this card gets a sentence. */
function rejectionLabel(code: string): string {
  switch (code) {
    case "empty_batch":
      return "לא התקבלו שורות כלל";
    case "volume_drop":
      return "כמות השורות נמוכה בהרבה מהרגיל";
    case "duplicate_batch":
      return "תוכן זהה כבר נטען בעבר";
    case "duplicate_keys":
      return "אותו מזהה הופיע יותר מפעם אחת";
    case "corrupted_rows":
      return "חלק מהשורות אינן תקינות";
    default:
      return code;
  }
}
