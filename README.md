# SMIS — School Management Information System

A **hybrid** school management system: one codebase that runs as

| How | Who uses it | Internet needed? |
|---|---|---|
| **Desktop app** (Electron, Windows installer) on the school office computer | Director, bursar, admin, HR | No — the office computer is the server |
| **Browser on the school network** (`http://<office-pc-ip>:3000`) | Teachers' laptops, other office PCs, phones on school Wi-Fi | No |
| **Installable web app (PWA)** — "Install SMIS" in Chrome/Edge, "Add to Home screen" on phones | Everyone | Works offline for attendance & marks, syncs later |
| **Online** — same server hosted behind HTTPS | Parents and students from home | Yes |

All modes share **one database**, so there are never two disconnected copies of student or finance records.

## Quick start (development / demo)

Requires **Node.js 22.5 or newer** (uses the built-in `node:sqlite` — no `npm install` needed to run).

```bash
node server/server.js
```

Open http://localhost:3000. On Windows you can also double-click `start-smis.bat`.

A demo database (fictional school, 132 students, 18 staff, a year of attendance, marks and payments) is created automatically in `data/smis.db` on first run. To reset it, delete the `data/` folder.

**Demo accounts** — all use password `demo1234` (tap a role on the sign-in screen):
`director`, `headteacher`, `teacher`, `bursar`, `hr`, `admin`, `parent`, `student`, `sysadmin`.

> Change or disable every demo account before real student data is entered.

## Modules

- **Dashboard** — tailored per role: KPIs, attendance trend, cash flow, alerts that need action (repeated absences, pending leave, expenses awaiting approval, unapproved marks, expiring contracts, overdue books, low stock), quick actions.
- **Students** — registration with auto admission numbers, guardians & emergency contacts, status (active/transferred/withdrawn…), full profile with academics, attendance, finance, discipline, library.
- **Staff & HR** — directory, qualifications, contracts (expiry warnings), salaries (visible only to HR/finance/director), leave requests & approval, staff attendance.
- **Attendance** — one-tap daily register (P/L/A/E), automatic percentages, repeated-absence alerts, **works offline**.
- **Marks & exams** — keyboard-fast mark entry with range validation, head-teacher approval workflow, class ranking, printable **report cards** (provisional until approved).
- **Timetable** — weekly grid per class or teacher, click-to-edit with **teacher and room conflict detection**.
- **Academics setup** — classes/streams, subjects, teacher assignments, assessments, terms.
- **Finance** — fee structures, bulk term invoicing, payments by cash/bank/Mobile Money with **duplicate-reference protection**, printable receipts, **reversals instead of deletion**, expenses with director approval, budgets vs actual, cash flow.
- **Payroll** — monthly runs from staff salaries, draft → paid.
- **Library, Inventory, Discipline, Announcements, Calendar.**
- **Parent / student portal** — attendance, results, fee balance, invoices, timetable, announcements — only for their own children.
- **Reports** — enrollment, attendance, absentees, academic & subject performance, fee collection, arrears, budget vs actual, cash flow, staff, payroll, executive summary. Filter by term/class/date range, export **CSV / Excel**, print or save as **PDF**.
- **System** — users & roles, password resets, full **audit log**, school settings, one-click database backup, LAN address display.

## Ease of use

- **Ctrl + K** (or `/`) opens a command palette: search students, receipts, invoices, staff or jump to any page/action.
- English · **Kinyarwanda** · Français menus, light/dark theme, adjustable text size.
- Responsive: sidebar on computers, bottom navigation on phones, tables become cards on small screens.
- Every screen only shows what the signed-in role is allowed to use.

## Security built in

- Passwords hashed with scrypt; login throttling (8 failures / 10 min).
- HttpOnly, SameSite=Strict session cookies; 45-minute idle timeout; sessions killed on password change/reset.
- Role-based access checked **on the server** for every request (a parent cannot open another child's profile; a teacher only sees their own classes and never sees salaries).
- CSRF header check, strict Content-Security-Policy, security headers.
- Audit log for sign-ins, failed logins, creates/updates, payments, reversals, approvals, exports, profile views and backups.
- Financial records cannot be deleted — only reversed with a reason.
- Cached offline data is cleared on sign-out (shared office computers).

Before going live in Rwanda: serve over **HTTPS**, take encrypted off-site backups and test restoring them, publish a privacy notice, obtain parental consent where required, and check registration obligations with the National Cyber Security Authority's Data Protection and Privacy Office (Law No. 058/2021).

## Desktop app (Windows)

```bash
npm install          # installs Electron + electron-builder (dev only)
npm run desktop      # run the desktop app
npm run build:win    # build a Windows installer into dist/
```

The desktop app's **SMIS** menu switches between:
- **School server** — the database lives on this computer (`%APPDATA%/smis/smis.db`) and other devices connect over the school network; *Copy school network address* shows the URL to share.
- **Connect to server** — this computer uses a central SMIS server (LAN or online).

If the bundled Electron runtime does not support `node:sqlite`, the app falls back to the system's Node.js 22.5+.

## Online deployment

Run `node server/server.js` on any Node 22.5+ host behind an HTTPS reverse proxy (Caddy, Nginx) that sets `X-Forwarded-Proto: https`. Environment variables: `PORT` (default 3000), `HOST` (default 0.0.0.0), `SMIS_DB` (database file path). For many concurrent schools, migrate the SQL schema in `server/db.js` to PostgreSQL.

## Project layout

```
server/   server.js (HTTP + REST API, reports)  db.js (schema + demo seed)  security.js (auth, roles)
public/   index.html  app.css  js/core.js (API, offline queue, UI kit, charts)  js/views.js (pages)  js/main.js (shell, router, palette)  sw.js (offline)
desktop/  main.js (Electron shell)
```
