# Deploy & Server Setup

How the "Publish" button, the dual generation templates, and the data-in-KSA
architecture are wired — and everything you must set up (accounts, secrets,
infra) to make them work. Code is done; this covers the **operational** steps.

> Auth (Zitadel) server provisioning has its own guide: [`auth-server-setup.md`](./auth-server-setup.md).

---

## Architecture in one picture

```
┌───────────── COMPUTE PLANE (see PDPL) ─────────────┐
│ Etlaq control app (Next.js)  ·  build sandboxes     │
│ Deployed apps:                                      │
│   • Vite SPA      → Netlify (static)      [clean]    │
│   • Next.js app   → Vercel  (SSR/API) [⚠ transfer]  │
└───────────────────────┬─────────────────────────────┘
                         │  HTTPS (Supabase client)
                         ▼
┌───────────── DATA PLANE (must be in KSA) ───────────┐
│ Self-hosted Supabase  (Postgres + Auth data + Storage)│
│ Self-hosted Zitadel   (user accounts)                 │
│ = residency boundary; multi-tenant by schema/org      │
└──────────────────────────────────────────────────────┘
```

Residency rule (corrected — see **Data residency & PDPL** below): storing data
in KSA is necessary but **not sufficient**. Under PDPL a "transfer" is moving
personal data *for processing* — so a server outside KSA that *reads/computes on*
the data is a transfer, even if the data is stored in KSA and the access is
transient. Static frontends are fine (the browser talks straight to KSA); a
**non-KSA app server that processes personal data is a transfer** subject to
Article 29.

- **One "Publish" button.** `/api/deploy` inspects the generated app's source and
  auto-routes: Next.js → full-stack host, Vite → Netlify. The user never chooses.
- **Two templates, auto-selected.** The first build prompt is classified: a
  backend need (auth/db/server/payments) → Next.js; otherwise Vite. Stored on
  `projects.framework`.

> **Compliance status:** the static/Vite→Netlify path is clean. The full-stack
> path currently targets **Vercel (outside KSA), which is a PDPL transfer** — a
> stopgap. The intended target is a **KSA-hosted Next.js runtime** so no personal
> data is processed abroad. See the two sections below.

---

## Data residency & PDPL (data-transfer analysis)

PDPL defines a **transfer** as moving personal data "from one place to another
**for Processing**." The test is not *where the data is stored* but *whether a
party outside KSA reads/processes it* — even transiently. Two cases:

- **Case 1 (not a transfer):** non-KSA infra only serves static assets/code; the
  actual personal data never reaches a non-KSA server. **Clean.**
- **Case 2 (a transfer):** a non-KSA server receives/reads/computes on personal
  data (SSR, API routes, logs with PII, caching). **Subject to Article 29**
  (adequacy assessed by SDAIA, data minimization, no prejudice to national
  interest).

Mapped onto our components:

| Component | Runs | Touches personal data? | Verdict |
|---|---|---|---|
| **Static (Vite) app → Netlify** | outside KSA | No — browser talks directly to KSA Supabase; Netlify only serves static files | ✅ Case 1, clean |
| **Full-stack (Next.js) app → Vercel** | outside KSA | **Yes** — SSR/API routes read KSA data to render | ⚠️ **Case 2, a transfer** |
| Zitadel (accounts) | KSA | yes | ✅ in-KSA |
| Etlaq control app | KSA (prod: `/opt/open-love`) | project/chat data | ✅ keep in KSA |
| Build sandboxes (E2B/Vercel) | outside KSA | app *code*, not end-user PII | ✅ clean |
| AI providers (Anthropic/Z.AI/Groq…) | outside KSA | build instructions + code, not end-user PII | ✅ keep it that way |
| Analytics / error trackers | — | — | ✅ none added — don't add non-KSA ones that capture PII |

**The one gap: full-stack apps on Vercel.** To make every app Case-1 clean
without an Article 29 process, run the **Next.js runtime in KSA** (self-hosted —
e.g. Coolify/containers on the KSA VM) instead of Vercel. The change is contained
almost entirely in `lib/deploy/vercel.ts` (swap the target); detection, the
single Publish button, templates, and the env split are unchanged.

Two standing rules: **keep the control app in KSA**, and **never wire a non-KSA
analytics/error tracker that captures PII**.

---

## Part A — Manual steps you must do yourself

These involve accounts, secrets, or infrastructure — they cannot be done in code.

### A1. Deploy provider accounts + tokens
| Provider | Why | Action |
|---|---|---|
| **Netlify** | hosts static (Vite) apps | Create a Personal Access Token: https://app.netlify.com/user/applications#personal-access-tokens → put in `NETLIFY_API_KEY`. *(already set)* |
| **Vercel** | hosts full-stack (Next.js) apps *(interim — PDPL transfer; see below)* | Create an account + token: https://vercel.com/account/tokens → put in `VERCEL_TOKEN`. If the token is team-scoped, also set `VERCEL_TEAM_ID`. |

Netlify (static) is fine outside KSA. **Vercel (full-stack) is an interim target
that constitutes a PDPL transfer** — see *Data residency & PDPL*; the intended
target is a KSA-hosted Next.js runtime.

### A2. KSA data plane (the residency boundary)
Already running in dev as local Docker Supabase (`supabase start`) + self-hosted
Zitadel. For **production** you must:

1. Stand up a **KSA-region VM** (e.g. GCP Dammam `me-central2`, Oracle
   Jeddah/Riyadh, or AWS Riyadh `me-central-2`).
2. Run the same **self-hosted Supabase** stack there, exposed on a **public
   HTTPS URL** (e.g. `https://db.<your-ksa-domain>`). See A4 — this is critical.
3. Run **self-hosted Zitadel** there too, public HTTPS (`https://auth.<your-ksa-domain>`).
   Create a service-user PAT with org-creation rights → `ZITADEL_TOKEN`.

### A3. Where the Etlaq control app runs
Keep the control app **in KSA** (prod: `/opt/open-love`). Its control-plane
Postgres holds project data + chat history, and the app server reads/processes
it — so running the server outside KSA would itself be a PDPL transfer (same
logic as the full-stack path). Point `DATABASE_URL`/`DIRECT_DATABASE_URL` at the
KSA Postgres.

### A4. ⚠️ Make the KSA Supabase publicly reachable (the #1 production gotcha)
In dev, Supabase is on `127.0.0.1:54321`. **Deployed apps cannot reach that:**
- A **static app on Netlify** runs in the visitor's browser and calls
  `NEXT_PUBLIC_SUPABASE_URL` / `VITE_SUPABASE_URL` directly.
- A **full-stack app on Vercel** calls the Supabase URL from Vercel's servers.

Both need a **public HTTPS Supabase URL served from your KSA VM**. Until that
exists, apps deploy but can't talk to their database. So in production the
injected env must point at the public KSA URL, never localhost.

---

## Part B — Server / config steps

### B1. Apply database migrations (required)
Adds `deploy_target`, `vercel_project_id`, `framework` to `projects`.
```bash
npm run db:migrate
```
Run against whichever Postgres the app uses (dev localhost now; KSA Postgres in prod).

### B2. Set environment variables
All live in `.env.local` (dev) or the server's environment (prod). See the
reference table below. The **new** ones for this feature set are `VERCEL_TOKEN`,
`VERCEL_TEAM_ID`, `ZITADEL_URL`, `ZITADEL_TOKEN`.

### B3. Restart the app
Env changes require a dev-server / process restart to take effect.

### B4. No build/CI changes needed
Vercel builds full-stack apps itself; the sandbox builds static apps. Nothing to
configure in a pipeline.

---

## Environment variable reference

| Var | Plane | Required for | Prod note |
|---|---|---|---|
| `NETLIFY_API_KEY` | compute | static deploys | any region |
| `VERCEL_TOKEN` | compute | **full-stack deploys** | interim — PDPL transfer; move to KSA host |
| `VERCEL_TEAM_ID` | compute | full-stack (team tokens) | optional |
| `NEXT_PUBLIC_SUPABASE_URL` | data | app ↔ DB | **public KSA HTTPS URL** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | data | app ↔ DB (RLS) | KSA instance's key |
| `SUPABASE_SERVICE_ROLE_KEY` | data | server-side provisioning | KSA; never ship to tenant apps |
| `DATABASE_URL` / `DIRECT_DATABASE_URL` | data | control-plane + migrations | KSA Postgres |
| `CREDENTIALS_ENCRYPTION_KEY` | control | encrypt per-project creds | keep stable/secret |
| `ZITADEL_URL` | data | "+ Auth" button | **public KSA HTTPS URL** |
| `ZITADEL_TOKEN` | data | auth org provisioning | KSA service-user PAT |
| `SANDBOX_PROVIDER` + `E2B_API_KEY` (or Vercel sandbox creds) | compute | code generation | any region |
| AI keys (`ANTHROPIC_API_KEY`, `ZAI_API_KEY`, `GROQ_API_KEY`, …) | compute | generation | any region |
| `FIRECRAWL_API_KEY` | compute | website scraping | any region |

---

## Going-live checklist

- [x] Migrations applied against the production Postgres *(2026-07-03 — via psql `ADD COLUMN IF NOT EXISTS`; note: this DB has no drizzle journal — schema was originally `db:push`ed, so `npm run db:migrate` cannot be used against it)*.
- [x] Supabase reachable at a public HTTPS URL: `https://auth.etlaq.sa` (Caddy → Kong :8000).
- [x] Zitadel deployed at `https://id.etlaq.sa` (Caddy → :8080, `/opt/zitadel`).
- [x] `VERCEL_TOKEN` set *(token validated; `VERCEL_TEAM_ID` not needed — token resolves to the default team)*.
- [x] `NETLIFY_API_KEY` set.
- [x] `NEXT_PUBLIC_*` Supabase values are the public ones (baked into the image as build args).

## Production server layout (as of 2026-07-03)

| What | Where |
|---|---|
| App repo + `.env.local` | `/opt/open-love` |
| App container | `open-love-prod` (image `open-love:paas`, `--network supabase_default`, `127.0.0.1:3000`) |
| Supabase self-host | `/opt/supabase-selfhost/docker` (compose project `supabase`) |
| Zitadel | `/opt/zitadel` (compose; PAT at `/opt/zitadel/pat/zitadel-pat`, masterkey in `/opt/zitadel/.env`) |
| Caddy routes | `build.etlaq.sa` → app :3000 · `auth.etlaq.sa` → Kong :8000 · `id.etlaq.sa` → Zitadel :8080 |

Redeploy after a code change:

```bash
cd /opt/open-love && git pull
set -a && . ./.env.local && set +a
docker build -t open-love:paas \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" .
docker rm -f open-love-prod
docker run -d --name open-love-prod --network supabase_default \
  -p 127.0.0.1:3000:3000 --env-file /opt/open-love/.env.local \
  --restart unless-stopped open-love:paas
```

## Still open (product decisions, not blockers)

- **Move the full-stack target into KSA (PDPL).** Vercel is an interim host and
  is a data transfer. Swap it for a KSA-hosted Next.js runtime (Coolify /
  containers on the KSA VM); the change is contained in `lib/deploy/vercel.ts`.
  Until then, full-stack apps are the only non-compliant path.
- **Vercel `secretEnv` is intentionally empty.** Shipping the shared Supabase
  service-role key to a tenant app would break tenant isolation. A per-project
  scoped key must be minted before any server-only secret is injected.
- **Region latency.** Whichever full-stack host is used, keep it close to the KSA
  DB to cut app↔DB round-trips.

## Needs live-sandbox validation (typechecks, not runtime-tested)

- Next.js dev server behind the E2B/Vercel sandbox proxy (HMR/websocket, port
  5173 binding), `setupNextApp` scaffold + `npm install` in each sandbox, and a
  real Vercel full-stack deploy.
