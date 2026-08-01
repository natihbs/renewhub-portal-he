# Remix of RenewHub Dashboard

Build a modern internal Hebrew web application called "RenewHub".

RenewHub is an internal team portal for an insurance renewals department consisting of two teams:

חידושי רכב

חידושי דירה

The entire interface must be in Hebrew and use full right-to-left layout.

This is currently a prototype. Do not use real customer data, real phone numbers, identification numbers, policy details, medical information or other sensitive information. Use fictional demonstration data only.

GENERAL DESIGN

Create a polished, professional and friendly internal dashboard.

Design requirements:

Full RTL layout

Hebrew interface

Desktop-first but fully responsive for mobile

Clean corporate appearance

White and light-gray backgrounds

Red accents inspired by an insurance company brand

Rounded cards

Clear typography

Subtle shadows

Accessible contrast

Simple navigation

Do not use excessive animations

Do not copy any protected company logo

Use a temporary text logo that says RenewHub

Create a left-side navigation menu adapted correctly for RTL.

The navigation must contain:

דף הבית

ביצועים

תחרויות

מרכז ידע

האזנות ומשוב

ניהול המערכת

USER ROLES

Create two prototype roles:

מנהל

נציג

Manager permissions:

View all team data

Add and edit representatives

Update targets and results

Create competitions

Update competition scores

Add knowledge articles

Submit call-listening feedback

View team-wide statistics

Representative permissions:

View their personal dashboard

View team competitions

Read knowledge articles

View feedback assigned to them

Cannot edit performance data

For the prototype, create a simple role switcher allowing the viewer to switch between מנהל and נציג without using real authentication.

PAGE 1 - דף הבית

Create a dashboard homepage with:

Welcome message

Current date

Monthly team target

Current team result

Percentage of target achieved

Number of workdays remaining

Three leading representatives

Latest announcements

Quick action buttons

Quick actions:

עדכון ביצועים

הוספת האזנה

יצירת תחרות

הוספת תוכן מקצועי

Include separate summary cards for:

חידושי רכב

חידושי דירה

PAGE 2 - ביצועים

Create a performance page with two tabs:

חידושי רכב

חידושי דירה

Create a table containing:

שם הנציג

יעד חודשי

ביצוע נוכחי

אחוז עמידה ביעד

פער מהיעד

דירוג

מגמה

סטטוס

Status options:

מעל היעד

בקצב הנדרש

דורש שיפור

Use progress bars for target completion.

Allow the manager to:

Add a representative

Edit a representative

Update monthly target

Update current performance

Filter by team

Search by representative name

Sort by performance and target achievement

Use fictional Hebrew names and demonstration data.

PAGE 3 - תחרויות

Create a competitions page.

Include:

Active competition card

Competition name

Start date

End date

Competition rules

Prize description

Leaderboard

Medal icons for the top three places

Score breakdown for each representative

Allow the manager to:

Create a new competition

Edit competition rules

Add scoring categories

Update scores

Close a competition

Create a fictional active competition called:

"מונדיאל החידושים"

Example scoring categories:

חידוש ללא שדרוג

חידוש עם שדרוג עד 250 ₪

חידוש עם שדרוג מעל 250 ₪

עמידה ביעד זמן דיבור

יום עבודה מעל 9 שעות

איחור

Allow both positive and negative scores.

PAGE 4 - מרכז ידע

Create a searchable knowledge center.

Categories:

ביטוח רכב

ביטוח דירה

מנורה ON

תסריטי שיחה

טיפול בהתנגדויות

שאלות נפוצות

הדרכות

Each article card should contain:

Article title

Category

Short summary

Last update date

Estimated reading time

Open article button

Create fictional sample articles:

ההבדל בין ביטוח מקיף לביטוח צד ג'

כיצד להציג ערך בחידוש ביטוח רכב

טיפול בהתנגדות מחיר

יתרונות מנורה ON

שאלות שחובה לשאול בחידוש דירה

כיצד לסכם שיחת מכירה בצורה נכונה

Allow managers to:

Create an article

Edit an article

Delete an article

Mark an article as important

PAGE 5 - האזנות ומשוב

Create a call-listening evaluation form.

Fields:

צוות

שם הנציג

תאריך ההאזנה

מזהה שיחה פנימי

סוג השיחה

שם המאזין

Do not request a customer phone number.

Evaluation criteria:

פתיחת שיחה ברורה ומקצועית

אימות צורכי הלקוח

הצגת יתרונות המוצר

יצירת ערך

טיפול בהתנגדויות

הצעת שדרוג

סיכום השיחה

עמידה ברגולציה

שירותיות

הנעה לסגירה

For every criterion allow:

בוצע

בוצע חלקית

לא בוצע

לא רלוונטי

Automatically calculate a score from 0 to 100.

Add text areas:

נקודות לשימור

נקודות לשיפור

סיכום מנהל

משימה להמשך

Create a feedback history table.

Representatives should only see feedback assigned to them.

PAGE 6 - ניהול המערכת

Create a manager-only administration page.

Sections:

ניהול נציגים

ניהול צוותים

ניהול תכנים

ניהול תחרויות

הגדרות ניקוד

הודעות ועדכונים

PROTOTYPE DATA

Create realistic fictional demonstration data for:

8 car renewals representatives

4 home renewals representatives

Monthly targets and results

One active competition

Six knowledge articles

Five call-listening feedback records

Three announcements

TECHNICAL REQUIREMENTS

Use reusable components

Use a consistent design system

Use clear loading, empty and error states

Validate all forms

Add confirmation before deleting data

Use charts only where they add clear value

Make all tables usable on mobile

Format dates in Israeli format

Format numbers and currency correctly

Store prototype data locally or in the platform's built-in database

Prepare the application architecture so real authentication and a secure database can be added later

Before implementing, create a short implementation plan and data structure.

Then build the first working version of the application.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://renewhub-portal-he.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/f20b9a2c-ec66-4243-b41d-84858960cd6f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
