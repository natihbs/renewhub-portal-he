// App metadata: version, build, changelog.

export const APP_NAME = "Pulse";
export const APP_DESCRIPTOR = "Sales Performance Platform";
export const APP_TAGLINE = "Every team has a pulse.";
export const APP_VERSION = "1.0.0-rc.2";
// Derived from APP_VERSION so the two can never drift apart (they previously
// did: this stayed "Release Candidate 1" after the version moved to rc.2).
const rcMatch = /-rc\.(\d+)$/.exec(APP_VERSION);
export const APP_STAGE = rcMatch ? `Release Candidate ${rcMatch[1]}` : "General Availability";
// Build number is stable per build (bundler inlines Date.now at import time).
export const BUILD_NUMBER = `${Math.floor(Date.now() / 1000).toString(36).toUpperCase()}`;
export const BUILD_DATE = new Date().toISOString().slice(0, 10);

export type ChangelogEntry = {
  version: string;
  date: string;
  title: string;
  items: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.0-rc.2",
    date: BUILD_DATE,
    title: "אמון ואמינות",
    items: [
      "חסימת ייבוא קבצים המכילים מידע רגיש: תעודות זהות, טלפונים, אימיילים ומספרי פוליסה",
      "היסטוריית ייבוא מורחבת: תאריך, שעה, קובץ, נציגים שעודכנו, אזהרות ושגיאות",
      'חלון פירוט מלא לכל ייבוא בלחיצה על "פרטים"',
      'חלון "מה חדש" המוצג לאחר עדכון גרסה',
    ],
  },
  {
    version: "1.0.0-rc.1",
    date: "2026-07-22",
    title: "מועמד לשחרור ראשון",
    items: [
      "חלונית 'אודות' עם גרסה ומספר בילד",
      "עמוד יומן שינויים",
      "כפתור צף לשליחת רעיונות ומשוב",
      "אינדיקציית שמירה גלובלית ומסרים ידידותיים בעברית",
      "ליטוש כללי, נגישות RTL ותיקוני יציבות",
    ],
  },

  {
    version: "0.9.0",
    date: "2026-07-15",
    title: "מרכז האזנות חכם",
    items: [
      "לוח בקרה, תור האזנות ומפת חום צוותית",
      "טופס האזנה מובנה עם 10 קטגוריות מקצועיות",
      "תוכנית אימון אוטומטית והמלצות מאמרים",
      "יומן האזנות ותגי הישגים",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-07-08",
    title: "מרכז תקשורת AI",
    items: [
      "מחוללי הודעות: בוקר, סיכום יום, תחרות, מחמאות, אימון, משוב אישי",
      "תבניות ווטסאפ / מייל / הודעה פנימית",
      "היסטוריית תקשורת מקומית עם CRUD",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-07-01",
    title: "פתיחת יום",
    items: [
      "לוח סטטוס נתונים ורענון",
      "מעקב שיחות מנהל וסוגיות חיתום",
      "מחולל עדכון בוקר לווטסאפ",
      "צ'ק-ליסט יומי עם שמירה מקומית",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-06-20",
    title: "ייבוא נתונים",
    items: [
      "אשף 5 שלבים לייבוא Excel / CSV",
      "מיפוי עמודות ותבניות שמורות",
      "בדיקות ולידציה, זיהוי כפילויות והתאמת נציגים",
      "היסטוריית ייבוא עם ביטול פעולה אחרון",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-06-10",
    title: "סביבת עבודה לנציג",
    items: [
      "מגירה מלאה עם פרופיל, ניתוח ומגמות",
      "היסטוריית האזנות, הערות מנהל ומשימות",
      "הישגים, הכשרות ופעולות מהירות",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-05-28",
    title: "חוויית מנהל מקצועית",
    items: [
      "חיפוש גלובלי ופקודות מהירות (Ctrl+K)",
      "פעילות אחרונה, מועדפים והתראות",
      "מיקרו-אינטראקציות ומקשי קיצור",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-05-15",
    title: "עמוד ביצועים מקצועי",
    items: [
      "טבלה נשלטת עם מיון, סינון וסטטוסים",
      "מגירת פרטי נציג עם גרף 6 חודשים",
      "רמת סיכון, מגמות ופעולות מהירות",
      "ייצוא CSV ותצוגת מובייל",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-05-01",
    title: "מרכז שליטה למנהל",
    items: [
      "כרטיס מצב צוות עם תחזית מול יעד",
      "התראות מנהל ותובנות אוטומטיות",
      "משימות היום עם שמירה מקומית",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-04-18",
    title: "גרסה ראשונית",
    items: [
      "שלד אפליקציה עם ניווט RTL, פונט Heebo וטמות אדומות",
      "דשבורד, ביצועים, תחרויות, מרכז ידע והאזנות",
      "מתג תפקיד: מנהל / נציג",
    ],
  },
];
