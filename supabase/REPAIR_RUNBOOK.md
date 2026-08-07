# תיקון סחיפת מיגרציות — פונקציות RPC חסרות

## הבעיה

קישור חשבון משתמש לנציג נכשל עם:

```
Could not find the function public.link_representative_to_user(_check_expected, _expected_current_user_id, _rep_id, _user_id) in the schema cache
```

זו שגיאת `PGRST202` של PostgREST: הקוד קורא לפונקציית מסד נתונים שאינה קיימת
בסביבת ה-Supabase המחוברת. המשמעות: מסד הנתונים החי מפגר אחרי המיגרציות שבריפו.
הקוד תקין — אין לשנות שמות או חתימות.

הפונקציות שהאפליקציה דורשת (כולן נוצרות על ידי מיגרציות קיימות בריפו):

| פונקציה | מיגרציה |
|---|---|
| `public.set_representative_active_with_profile_sync(_rep_id, _active, _sync_profile)` | `20260806090000_set_representative_active_with_profile_sync.sql` |
| `public.link_representative_to_user(_rep_id, _user_id, _expected_current_user_id, _check_expected)` | `20260806091500_link_representative_to_user.sql` |
| `public.toggle_rep_task_done(_task_id)` | `20260806111500_toggle_rep_task_done.sql` |
| `public.update_representative_metrics_with_team_sync(_rep_id, _name, _apply_name, _current_result, _apply_current_result, _monthly_target, _apply_monthly_target, _team_id, _apply_team)` | `20260806112000_update_representative_metrics_with_team_sync.sql` |

החתימות אומתו בהרצה מקומית של קובצי המיגרציה על PostgreSQL 16: כל ארבע נוצרות
בדיוק בחתימה שהקליינט קורא לה (קריאה בפרמטרים בשם, כפי ש-PostgREST שולח),
ומחסום "משתמש אחד — נציג אחד" (P0004) פועל.

חשוב: אם `link_representative_to_user` חסרה, כמעט ודאי שגם מיגרציות אחרות מאותו
טווח תאריכים ואילך חסרות (feedback RPCs, KPI RLS, snapshots ועוד). אל תריצו רק
את הארבע — סגרו את כל הפער.

## התיקון (פעולה ידנית — נדרשת גישה למסד החי)

סביבת הפיתוח שבה נכתב הקוד חסומה ברשת מול `*.supabase.co`, ולכן אימות מול המסד
החי והרצת התיקון חייבים להתבצע ידנית על ידי מי שיש לו גישה.

### דרך מועדפת — Supabase CLI (מחיל את כל המיגרציות החסרות, בסדר הנכון)

```bash
supabase link --project-ref gtitpscdpbdvnmvdgrjv   # פעם אחת
supabase migration list --linked                    # מציג אילו מיגרציות חסרות במסד החי
supabase db push                                    # מחיל את כל החסרות לפי סדר הקבצים
```

### דרך חלופית — SQL Editor בלוח הבקרה של Supabase

1. זהו את המיגרציה האחרונה שהוחלה במסד החי (`supabase migration list --linked`,
   או השוו מול `select * from supabase_migrations.schema_migrations`).
2. הריצו את קובצי המיגרציה החסרים מתוך `supabase/migrations/`, **לפי סדר שם
   הקובץ (חותמת הזמן)**, כל קובץ בשלמותו. אל תדלגו ואל תשנו דבר בקבצים.
3. המיגרציות אדיטיביות (CREATE OR REPLACE / ALTER) — הן אינן מוחקות נתונים.

### רענון מטמון הסכימה של PostgREST

Supabase בדרך כלל מרענן אוטומטית אחרי DDL. אם השגיאה ממשיכה גם אחרי ההרצה,
הריצו ב-SQL Editor:

```sql
NOTIFY pgrst, 'reload schema';
```

## אימות אחרי התיקון

ב-SQL Editor:

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (
  'link_representative_to_user',
  'set_representative_active_with_profile_sync',
  'update_representative_metrics_with_team_sync',
  'toggle_rep_task_done');
```

צריכות לחזור 4 שורות, עם החתימות מהטבלה למעלה. לאחר מכן באפליקציה: קישור חשבון
קיים לנציג מרשימת הנציגים אמור להצליח (או להיכשל בשגיאה עסקית ברורה בעברית —
לא בשגיאת schema cache).

עד שהתיקון מורץ, האפליקציה מציגה עבור השגיאה הזו הודעה עברית ברורה במקום טקסט
ה-PostgREST הגולמי (ראו `translateDbFunctionLookupError` ב-rep-admin.functions.ts).
