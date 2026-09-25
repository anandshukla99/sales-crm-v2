# Sales CRM

A full-stack sales CRM for managing leads through a pipeline, with role-based access, forecasting,
reporting, and an activity audit trail. Built as a classic three-tier application.

- **Frontend** — React 18 SPA (Create React App), React Router v6, Axios, Context API, Recharts
- **Backend** — Node.js + Express 4, Sequelize 6 (MySQL), JWT auth, bcrypt, Multer uploads
- **Database** — MySQL (versioned SQL migrations)

> **Deploying?** See **[DEPLOYMENT.md](DEPLOYMENT.md)** for free hosting on Netlify + Render + Aiven.

---

## Features

- **Leads** — table + Kanban board (drag-and-drop stage changes), search, multi-filter, bulk
  reassign/stage-change, and **Excel + PDF export**.
- **Lead form** — full field set: lead info, competitor, services with per-service rate & qty, deal
  size, phase & timeline (with ±2-day phase-date editing), contacts, PO document upload, and
  **rich-text notes**.
- **Role-based access** — Super Admin, Business Admin, PMO, BD, and Forecast roles, with per-module
  access levels (Leads / Dashboard / Forecast / Reports). BD data isolation is **enforced
  server-side** in SQL, not just hidden in the UI.
- **Activity log & stage history** — every field change and stage transition is recorded per lead,
  powering a conversion funnel, stage-bottleneck view, and "rotting deal" badges.
- **Weighted forecast** — pipeline value weighted by stage win-probability, alongside raw open pipeline.
- **Dashboards** — KPIs, leads-by-phase, weekly targets (global + per-BD), performance, overdue and
  renewal alerts, and a data-quality panel. Plus a public **Forecast Dashboard**.
- **Reports** — full filter panel with Excel/PDF export.
- **Settings** — admins manage users and reset passwords; every account can change its own password.

---

## Architecture

```
sales-crm/
├── backend/                 # Express API
│   ├── server.js            # boot: middleware → routes → migrations → listen
│   ├── config/database.js   # Sequelize instance (env-driven, optional TLS)
│   ├── models/              # Sequelize models + associations
│   ├── middleware/          # auth (JWT), scope (server-side data isolation)
│   ├── migrations/          # numbered .sql files — the schema source of truth
│   ├── routes/              # one file per resource, mounted at /api/<resource>
│   ├── services/            # scoring engine, permissions, audit
│   └── scripts/             # migrate.js, seed.js, recompute.js
├── frontend/                # React SPA (CRA)
│   └── src/
│       ├── App.jsx          # router + route guards
│       ├── context/         # AuthContext
│       ├── services/api.js  # one axios instance + every endpoint
│       ├── components/      # Layout, Sidebar, LeadForm, KanbanView, …
│       ├── pages/           # Login, Leads, Dashboard, Forecast, Reports, Settings, …
│       └── utils/           # constants + pure helpers
├── netlify.toml             # frontend hosting + API proxy config
├── render.yaml              # backend hosting blueprint
└── DEPLOYMENT.md            # step-by-step free deploy guide
```

The schema is owned entirely by versioned SQL files in `backend/migrations/`, tracked in a
`schema_migrations` table — `sequelize.sync()` is not used, so the database always matches git.

---

## Quick start (local)

Requires Node 18+ and a local MySQL 8+.

```bash
# Backend
cd backend
cp .env.example .env        # fill in DB creds, JWT_SECRET, SEED_ADMIN_*
npm install
npm run seed                # runs migrations, then seeds admin + BDs + dropdowns
npm run dev                 # http://localhost:4000

# Frontend (second terminal)
cd frontend
npm install
npm start                   # http://localhost:3000 (proxies /api → :4000)
```

Open http://localhost:3000 → pick a business → pick a person → sign in.
- **Admin:** the `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `backend/.env`.
- **BDs:** each starts with password `123456`, changed under **Password** after first login.
