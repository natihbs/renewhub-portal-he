import type { Feedback } from "./feedback-domain";
import type { KpiValueRow } from "./kpi-values";

export const UNASSIGNED_TEAM_LABEL = "ללא צוות";

export type Rep = {
  id: string;
  name: string;
  /** Source of truth for team membership: representatives.team_id. Null = unassigned. */
  teamId: string | null;
  /** Denormalized display name of the linked team (or the unassigned label). */
  teamName: string;
  monthlyTarget: number;
  currentResult: number;
  lastUpdatedAt?: string;
};


export type Announcement = { id: string; title: string; body: string; date: string };

export type CompetitionCategory = { id: string; label: string; points: number };
export type CompetitionScoreEntry = { repId: string; categoryId: string; count: number };
export type Competition = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  rules: string;
  prize: string;
  active: boolean;
  categories: CompetitionCategory[];
  scores: CompetitionScoreEntry[];
};

export type ArticleCategory =
  | "ביטוח רכב"
  | "ביטוח דירה"
  | "מנורה ON"
  | "תסריטי שיחה"
  | "טיפול בהתנגדויות"
  | "שאלות נפוצות"
  | "הדרכות";

export const ARTICLE_CATEGORIES: ArticleCategory[] = [
  "ביטוח רכב",
  "ביטוח דירה",
  "מנורה ON",
  "תסריטי שיחה",
  "טיפול בהתנגדויות",
  "שאלות נפוצות",
  "הדרכות",
];

export type Article = {
  id: string;
  title: string;
  category: ArticleCategory;
  summary: string;
  body: string;
  updatedAt: string;
  readMinutes: number;
  important: boolean;
};

export type Role = "manager" | "rep";

export type AppState = {
  role: Role;
  currentRepId: string; // active demo rep for "נציג" mode
  reps: Rep[];
  announcements: Announcement[];
  competitions: Competition[];
  articles: Article[];
  feedback: Feedback[];
  /** True while the Live Mode feedback query is still in flight. Always false in Demo Mode. */
  feedbackLoading: boolean;
  /** Set when the Live Mode feedback query failed. Always null in Demo Mode. */
  feedbackError: string | null;
  /**
   * Dated renewal-specific values (see src/lib/kpi-values.ts). Always empty in Demo
   * Mode — there is no fabricated renewal data; Demo Mode's teams have no real KPI
   * profile, so renewal sections correctly never render for them.
   */
  kpiValues: KpiValueRow[];
};

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return iso(d);
};
const daysFromNow = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return iso(d);
};

export const SEED: AppState = {
  role: "manager",
  currentRepId: "r1",
  feedbackLoading: false,
  feedbackError: null,
  kpiValues: [],
  reps: [
    { id: "r1", name: "יעל כהן", teamId: "demo-team-1", teamName: "חידושי רכב", monthlyTarget: 120, currentResult: 98 },
    { id: "r2", name: "אורי לוי", teamId: "demo-team-1", teamName: "חידושי רכב", monthlyTarget: 120, currentResult: 132 },
    { id: "r3", name: "דנה פרץ", teamId: "demo-team-1", teamName: "חידושי רכב", monthlyTarget: 110, currentResult: 76 },
    { id: "r4", name: "רון ביטון", teamId: "demo-team-1", teamName: "חידושי רכב", monthlyTarget: 130, currentResult: 145 },
    { id: "r5", name: "מיכל אזולאי", teamId: "demo-team-1", teamName: "חידושי רכב", monthlyTarget: 120, currentResult: 88 },
    { id: "r6", name: "שגיא דהן", teamId: "demo-team-1", teamName: "חידושי רכב", monthlyTarget: 120, currentResult: 115 },
    { id: "r7", name: "נועה מזרחי", teamId: "demo-team-1", teamName: "חידושי רכב", monthlyTarget: 100, currentResult: 62 },
    { id: "r8", name: "איתי שפירא", teamId: "demo-team-1", teamName: "חידושי רכב", monthlyTarget: 120, currentResult: 128 },
    { id: "r9", name: "טל אברהם", teamId: "demo-team-2", teamName: "חידושי דירה", monthlyTarget: 60, currentResult: 54 },
    { id: "r10", name: "ליאור חדד", teamId: "demo-team-2", teamName: "חידושי דירה", monthlyTarget: 55, currentResult: 61 },
    { id: "r11", name: "שירה בן דוד", teamId: "demo-team-2", teamName: "חידושי דירה", monthlyTarget: 60, currentResult: 38 },
    { id: "r12", name: "עומר יוסף", teamId: "demo-team-2", teamName: "חידושי דירה", monthlyTarget: 55, currentResult: 47 },
  ],
  announcements: [
    { id: "a1", title: "יעדים חדשים לרבעון", body: "החל מהחודש הבא יעודכנו היעדים בהתאם למגמת החידושים.", date: daysAgo(1) },
    { id: "a2", title: "מונדיאל החידושים יצא לדרך!", body: "התחרות המרכזית של החודש - בהצלחה לכולם.", date: daysAgo(4) },
    { id: "a3", title: "עדכון בתסריטי שיחה", body: "עודכנו תסריטי טיפול בהתנגדויות במרכז הידע.", date: daysAgo(9) },
  ],
  competitions: [
    {
      id: "c1",
      name: "מונדיאל החידושים",
      startDate: daysAgo(10),
      endDate: daysFromNow(20),
      rules:
        "כל נציג צובר נקודות לפי הקטגוריות למטה. הנקודות נצברות מדי יום ומתעדכנות ידנית ע\"י ההנהלה. שלושת המקומות הראשונים יזכו בפרסים.",
      prize: "מקום 1: סופ\"ש זוגי במלון | מקום 2: שובר 1,000 ₪ | מקום 3: שובר 500 ₪",
      active: true,
      categories: [
        { id: "cat1", label: "חידוש ללא שדרוג", points: 3 },
        { id: "cat2", label: "חידוש עם שדרוג עד 250 ₪", points: 6 },
        { id: "cat3", label: "חידוש עם שדרוג מעל 250 ₪", points: 10 },
        { id: "cat4", label: "עמידה ביעד זמן דיבור", points: 5 },
        { id: "cat5", label: "יום עבודה מעל 9 שעות", points: 4 },
        { id: "cat6", label: "איחור", points: -5 },
      ],
      scores: [
        { repId: "r1", categoryId: "cat1", count: 22 },
        { repId: "r1", categoryId: "cat2", count: 6 },
        { repId: "r1", categoryId: "cat4", count: 8 },
        { repId: "r2", categoryId: "cat1", count: 30 },
        { repId: "r2", categoryId: "cat3", count: 4 },
        { repId: "r2", categoryId: "cat5", count: 5 },
        { repId: "r4", categoryId: "cat1", count: 28 },
        { repId: "r4", categoryId: "cat2", count: 10 },
        { repId: "r4", categoryId: "cat3", count: 3 },
        { repId: "r4", categoryId: "cat6", count: 1 },
        { repId: "r6", categoryId: "cat1", count: 18 },
        { repId: "r6", categoryId: "cat2", count: 4 },
        { repId: "r8", categoryId: "cat1", count: 24 },
        { repId: "r8", categoryId: "cat2", count: 5 },
        { repId: "r8", categoryId: "cat4", count: 6 },
        { repId: "r9", categoryId: "cat1", count: 12 },
        { repId: "r9", categoryId: "cat2", count: 3 },
        { repId: "r10", categoryId: "cat1", count: 15 },
        { repId: "r10", categoryId: "cat3", count: 2 },
      ],
    },
  ],
  articles: [
    {
      id: "ar1",
      title: "ההבדל בין ביטוח מקיף לביטוח צד ג'",
      category: "ביטוח רכב",
      summary: "סקירה קצרה של ההבדלים המרכזיים בין הכיסויים ומתי כדאי להציע כל אחד.",
      body: "ביטוח מקיף מכסה נזקים לרכב שלך ולצד ג', לרבות גניבה ונזקי טבע. ביטוח צד ג' מכסה רק נזקים שגרמת לצד שלישי. שקול לפי גיל הרכב, שווי השוק והשימוש היומיומי.",
      updatedAt: daysAgo(2),
      readMinutes: 4,
      important: true,
    },
    {
      id: "ar2",
      title: "כיצד להציג ערך בחידוש ביטוח רכב",
      category: "תסריטי שיחה",
      summary: "מבנה שיחה מומלץ שמדגיש חיסכון, שירות ורצף כיסוי.",
      body: "פתחו בהצגת רצף הכיסוי ויתרונות הוותק, המשיכו לחיסכון היחסי לעומת הצעות מתחרות, וסיימו בהצגת השירות המהיר.",
      updatedAt: daysAgo(6),
      readMinutes: 3,
      important: false,
    },
    {
      id: "ar3",
      title: "טיפול בהתנגדות מחיר",
      category: "טיפול בהתנגדויות",
      summary: "כלים לפירוק התנגדות המחיר וחיזוק ערך הכיסוי.",
      body: "השתמשו בטכניקת פירוק העלות היומית, השוו לשירותים דומים והציעו חלופות שדרוג/גריעה.",
      updatedAt: daysAgo(3),
      readMinutes: 5,
      important: true,
    },
    {
      id: "ar4",
      title: "יתרונות מנורה ON",
      category: "מנורה ON",
      summary: "מה מקבלים הלקוחות באפליקציה ואיך זה מסייע לחידוש.",
      body: "האפליקציה מספקת ניהול פוליסות, שליחת מסמכים ופתיחת תביעות במהירות - הדגישו זאת בשיחה.",
      updatedAt: daysAgo(12),
      readMinutes: 2,
      important: false,
    },
    {
      id: "ar5",
      title: "שאלות שחובה לשאול בחידוש דירה",
      category: "ביטוח דירה",
      summary: "צ'קליסט של שאלות מפתח לבירור צרכים והתאמת הכיסוי.",
      body: "1. שינויים במבנה? 2. תכולה חדשה יקרת ערך? 3. מערכות סולאריות? 4. השכרה חלקית? 5. תוספת מבנה חוץ?",
      updatedAt: daysAgo(1),
      readMinutes: 4,
      important: false,
    },
    {
      id: "ar6",
      title: "כיצד לסכם שיחת מכירה בצורה נכונה",
      category: "הדרכות",
      summary: "מבנה סיכום שמעלה שיעורי חתימה ומצמצם ביטולים.",
      body: "חזרו על הנקודות המרכזיות, אשרו הבנה, ציינו תאריכים חשובים והציעו את שלב הבא באופן ברור.",
      updatedAt: daysAgo(15),
      readMinutes: 3,
      important: false,
    },
  ],
  feedback: [
    {
      id: "f1",
      repId: "r1",
      date: daysAgo(2),
      callId: "CAR-1042",
      callType: "חידוש",
      listener: "רות שני",
      criteria: {
        opening: "done", needs: "done", benefits: "partial", value: "done",
        objections: "partial", upsell: "not_done", summary: "done",
        regulation: "done", service: "done", closing: "partial",
      },
      score: 75,
      keep: "פתיחת שיחה מצוינת ושירותיות גבוהה.",
      improve: "יש לחזק את שלב הצעת השדרוג ולסגור בצורה החלטית.",
      managerSummary: "שיחה טובה, יש פוטנציאל לשיפור בסגירה.",
      nextTask: "לצפות בהדרכת שדרוג ולבצע 5 שיחות עם דגש על סגירה.",
      published: true,
      scheduleId: null,
    },
    {
      id: "f2",
      repId: "r2",
      date: daysAgo(5),
      callId: "CAR-1078",
      callType: "חידוש",
      listener: "רות שני",
      criteria: {
        opening: "done", needs: "done", benefits: "done", value: "done",
        objections: "done", upsell: "done", summary: "done",
        regulation: "done", service: "done", closing: "done",
      },
      score: 100,
      keep: "שיחה לדוגמה בכל שלב.",
      improve: "-",
      managerSummary: "שיחה מצטיינת, לשמש כדוגמה בהדרכה הבאה.",
      nextTask: "להקליט שיחה נוספת לשיתוף בצוות.",
      published: true,
      scheduleId: null,
    },
    {
      id: "f3",
      repId: "r9",
      date: daysAgo(3),
      callId: "HOME-334",
      callType: "מכירה",
      listener: "אבי מור",
      criteria: {
        opening: "done", needs: "partial", benefits: "done", value: "partial",
        objections: "not_done", upsell: "not_done", summary: "done",
        regulation: "done", service: "done", closing: "partial",
      },
      score: 65,
      keep: "שירותיות טובה ופתיחה מסודרת.",
      improve: "טיפול בהתנגדויות ושאלות בירור צרכים.",
      managerSummary: "יש לחזק את שלב הבירור והתמודדות עם התנגדויות.",
      nextTask: "לתרגל 3 תרחישי התנגדות בסדנה השבוע.",
      published: true,
      scheduleId: null,
    },
    {
      id: "f4",
      repId: "r3",
      date: daysAgo(7),
      callId: "CAR-1123",
      callType: "חידוש",
      listener: "רות שני",
      criteria: {
        opening: "partial", needs: "not_done", benefits: "partial", value: "not_done",
        objections: "not_done", upsell: "not_done", summary: "partial",
        regulation: "done", service: "partial", closing: "not_done",
      },
      score: 30,
      keep: "עמידה ברגולציה.",
      improve: "מבנה שיחה, בירור צרכים ושלב הסגירה.",
      managerSummary: "נדרש ליווי צמוד השבוע.",
      nextTask: "פגישת 1:1 עם ראש צוות + צפייה ב-2 הדרכות.",
      published: true,
      scheduleId: null,
    },
    {
      id: "f5",
      repId: "r10",
      date: daysAgo(1),
      callId: "HOME-355",
      callType: "חידוש",
      listener: "אבי מור",
      criteria: {
        opening: "done", needs: "done", benefits: "done", value: "done",
        objections: "done", upsell: "partial", summary: "done",
        regulation: "done", service: "done", closing: "done",
      },
      score: 95,
      keep: "שיחה חלקה עם התאמה מדויקת לצרכי הלקוח.",
      improve: "להעמיק בהצעת שדרוג תכולה.",
      managerSummary: "ביצועים מעולים, המשך כך.",
      nextTask: "לשתף טיפ מהשיחה במפגש הצוות.",
      published: true,
      scheduleId: null,
    },
  ],
};
