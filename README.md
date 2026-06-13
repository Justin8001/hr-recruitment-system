# מערכת גיוס מועמדים (HR Recruitment System)

מערכת עצמאית לניהול גיוס מועמדים: לוח קנבן לאורך שלבי הראיונות, ניהול מועמדים
ידני, וקריטריוני סינון עם ניקוד התאמה. גרסת fullstack של ה-artifact המקורי.

## מבנה

- **`backend/`** — Node.js + Express + TypeScript + PostgreSQL, אימות JWT.
- **`frontend/`** — אפליקציית עמוד יחיד (HTML/JS, ללא build) שמדברת עם ה-API.

## הרצה מקומית

### Backend
```bash
cd backend
cp .env.example .env          # ערוך: DATABASE_URL, JWT_SECRET
npm install
npm run migrate               # יוצר את הטבלאות
npm run reset-admin -- admin <סיסמה>   # יוצר משתמש admin
npm run dev                   # מאזין על פורט 3001
```

### Frontend
ערוך את `frontend/config.js` כך ש-`window.API_BASE` יצביע ל-backend
(`http://localhost:3001` לפיתוח מקומי), ופתח את `frontend/index.html`
דרך שרת סטטי (למשל `npx serve frontend`).

## פריסה חינמית

- **Database**: [Neon](https://neon.tech) — PostgreSQL.
- **Backend**: [Render](https://render.com) — Web Service (Docker), Root Directory = `backend`.
  משתני סביבה: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`. מיגרציות רצות אוטומטית בהפעלה.
- **Frontend**: [Netlify](https://netlify.com) — עדכן את `config.js` לכתובת ה-Render, וגרור את `frontend/`.

## מפת דרכים (שלבים הבאים)

- **שלב 2**: סריקת Outlook / Microsoft 365 דרך Microsoft Graph API.
- **שלב 3**: סינון AI דרך Anthropic API.
