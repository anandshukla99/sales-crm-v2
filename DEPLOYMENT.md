# Deploying Sales CRM (free hosting)

This app has three tiers. Netlify can only host the first, so the backend and database run elsewhere.
Everything below uses **free tiers with no credit card**.

| Tier | Hosted on | Cost |
|---|---|---|
| Frontend (React) | **Netlify** | Free |
| Backend (Express API) | **Render** (free web service) | Free |
| Database (MySQL) | **Aiven** (free MySQL) | Free |

**Deploy order matters:** Database → Backend → Frontend (the frontend needs the backend URL, the
backend needs the database URL).

You'll need free accounts on: [GitHub](https://github.com), [Aiven](https://aiven.io),
[Render](https://render.com), [Netlify](https://netlify.com).

---

## Step 1 — Put the code on GitHub

From this folder (`sales-crm`):

```bash
git init
git add .
git commit -m "Sales CRM — standalone"
git branch -M main
```

Then create a **new empty public repo** on GitHub (e.g. `sales-crm`) — do **not** add a README/.gitignore
there. Copy the commands GitHub shows under *"…or push an existing repository"*, which look like:

```bash
git remote add origin https://github.com/<your-username>/sales-crm.git
git push -u origin main
```

---

## Step 2 — Create the MySQL database (Aiven)

1. Aiven console → **Create service** → **MySQL**.
2. Pick the **Free plan**, any cloud/region near you, name it (e.g. `sales-crm-db`) → **Create**.
3. Wait until status is **Running**, then open the service's **Overview** → **Connection information**.
   Note these (you'll paste them into Render next):
   - **Host**, **Port**, **User** (usually `avnadmin`), **Password**, **Database name** (usually `defaultdb`).
   - SSL is required — that's already handled (`DB_SSL=true`).

You don't need to create tables — the backend runs its migrations automatically on first boot.

---

## Step 3 — Deploy the backend (Render)

1. Render dashboard → **New +** → **Blueprint** → connect your GitHub → pick the `sales-crm` repo.
   Render reads `render.yaml` and proposes a service called **sales-crm-api**.
2. It will prompt for the env vars marked as needed. Fill them from your Aiven connection info:

   | Variable | Value |
   |---|---|
   | `DB_HOST` | Aiven host |
   | `DB_PORT` | Aiven port |
   | `DB_NAME` | Aiven database name (e.g. `defaultdb`) |
   | `DB_USER` | Aiven user (e.g. `avnadmin`) |
   | `DB_PASSWORD` | Aiven password |
   | `SEED_ADMIN_EMAIL` | the admin email you want to log in with, e.g. `admin@demo.com` |
   | `SEED_ADMIN_PASSWORD` | a password you choose for that admin |

   (`DB_SSL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `SEED_ADMIN_NAME`, `SEED_ADMIN_BU` are pre-filled by the
   blueprint — `JWT_SECRET` is auto-generated.)

   > **No Blueprint?** Create a **Web Service** manually instead: Root Directory `backend`,
   > Build `npm install`, Start `npm run start:deploy`, Health check path `/api/health`, and add all
   > the variables above yourself (plus `DB_SSL=true`).

3. **Create** and wait for the first deploy. In **Logs** you should see migrations run, `Seed complete`,
   and `Sales CRM API listening`.
4. Test it: open `https://<your-service>.onrender.com/api/health` — it should return
   `{"status":"ok",...}`. **Copy your Render host** (the `<your-service>.onrender.com` part).

---

## Step 4 — Point the frontend at the backend, then deploy (Netlify)

1. In this repo, edit **`netlify.toml`** and replace both occurrences of
   `REPLACE-WITH-YOUR-BACKEND.onrender.com` with your real Render host. Commit and push:

   ```bash
   git add netlify.toml && git commit -m "Point Netlify proxy at backend" && git push
   ```

2. Netlify dashboard → **Add new site** → **Import an existing project** → pick the `sales-crm` repo.
   Netlify reads `netlify.toml`, so build settings are already correct (base `frontend`,
   build `npm run build`, publish `build`). Click **Deploy**.
3. When it finishes, open your Netlify URL (e.g. `https://sales-crm-xxxx.netlify.app`).

---

## Step 5 — Log in

- Pick a business (e.g. **Signage**) → **Business Admin / Manager** → sign in with the
  `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` you set on Render.
- Seeded **BD** users each start with password `123456` (they change it under **Password**).
- The **Forecast Dashboard** is reachable from the login screen.

---

## Good to know (free-tier caveats)

- **First load can be slow (~40–50s).** Render's free backend sleeps after 15 min idle; the first
  request wakes it. To keep it warm, add a free uptime pinger (e.g. UptimeRobot or cron-job.org)
  hitting `https://<your-service>.onrender.com/api/health` every ~10 minutes.
- **Uploaded PO documents don't persist** across backend restarts/redeploys on Render's free tier
  (ephemeral disk). Fine for a demo; for permanence, move uploads to object storage later.
- **Redeploys are automatic:** pushing to `main` triggers a new Netlify build and Render deploy.

---

## Local development (optional)

Requires a local MySQL. Backend:

```bash
cd backend
cp .env.example .env    # fill in local DB creds + JWT_SECRET + SEED_ADMIN_*
npm install
npm run seed            # migrations + seed admin/BDs/dropdowns
npm run dev             # http://localhost:4000
```

Frontend (in another terminal):

```bash
cd frontend
npm install
npm start               # http://localhost:3000 (proxies /api → :4000)
```
