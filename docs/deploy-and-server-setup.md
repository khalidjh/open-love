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
│ Deployed apps (both in-KSA, behind the same Caddy): │
│   • Vite SPA      → KSA runtime (Caddy files) [clean]│
│   • Next.js app   → KSA runtime (SSR/API)     [clean]│
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
  auto-routes: Next.js → full-stack container on the KSA runtime, Vite → static
  files on the KSA runtime. The user never chooses.
- **Two templates, auto-selected.** The first build prompt is classified: a
  backend need (auth/db/server/payments) → Next.js; otherwise Vite. Stored on
  `projects.framework`.

> **Compliance status:** both paths now run **in-KSA** and are Case-1 clean.
> Static (Vite) apps are served by Caddy on the KSA VM (`lib/deploy/ksa-static.ts`);
> full-stack (Next.js) apps run as containers on the KSA VM (`lib/deploy/ksa.ts`).
> Two opt-in escape hatches remain and both re-open a PDPL transfer — don't set
> them in production: `STATIC_TARGET=netlify` (static → Netlify) and
> `FULLSTACK_TARGET=vercel` (full-stack → Vercel).

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
| **Static (Vite) app → KSA runtime** | KSA (`<slug>.apps.etlaq.sa`) | No — browser talks directly to KSA Supabase; Caddy only serves static files | ✅ Case 1, clean |
| **Full-stack (Next.js) app → KSA runtime** | KSA (`<slug>.apps.etlaq.sa`) | yes — but inside KSA | ✅ in-KSA |
| Static → Netlify (`STATIC_TARGET=netlify` fallback only) | outside KSA | No — Netlify only serves static files | ✅ Case 1, but off by default |
| Full-stack → Vercel (`FULLSTACK_TARGET=vercel` fallback only) | outside KSA | **Yes** — SSR/API routes read KSA data to render | ⚠️ **Case 2, a transfer — off by default** |
| Zitadel (accounts) | KSA | yes | ✅ in-KSA |
| Etlaq control app | KSA (prod: `/opt/open-love`) | project/chat data | ✅ keep in KSA |
| Build sandboxes (E2B/Vercel) | outside KSA | app *code*, not end-user PII | ✅ clean |
| AI providers (Anthropic/Z.AI/Groq…) | outside KSA | build instructions + code, not end-user PII | ✅ keep it that way |
| Analytics / error trackers | — | — | ✅ none added — don't add non-KSA ones that capture PII |

**~~The one gap: full-stack apps on Vercel.~~ Closed (2026-07-03).** Full-stack
apps now deploy to the **KSA runtime** by default: each app builds and runs as a
container on the KSA VM behind Caddy at `<slug>.apps.etlaq.sa`
(`lib/deploy/ksa.ts`). SSR/API routes execute inside KSA — every path is now
Case-1 clean. Vercel remains only as an explicit escape hatch
(`FULLSTACK_TARGET=vercel`), which re-opens the transfer — don't set it in
production. See **KSA full-stack runtime** below for the mechanics.

**Static apps also moved in-KSA (2026-07-03).** Vite SPAs now build in the
sandbox and are served as static files by the same Caddy at
`<slug>.apps.etlaq.sa` (`lib/deploy/ksa-static.ts`) — no server runs at serve
time. This was prompted by the Netlify free-tier limit, and it also brings
static hosting inside KSA. Netlify survives only behind `STATIC_TARGET=netlify`.
See `static-deploy-via-caddy.md` for the mechanics and rollout checklist.

Two standing rules: **keep the control app in KSA**, and **never wire a non-KSA
analytics/error tracker that captures PII**.

---

## Part A — Manual steps you must do yourself

These involve accounts, secrets, or infrastructure — they cannot be done in code.

### A1. Deploy provider accounts + tokens
| Provider | Why | Action |
|---|---|---|
| **KSA runtime** | hosts **both** static (Vite) and full-stack (Next.js) apps in-KSA | No account — files + containers on this VM behind Caddy. One-time: wildcard DNS `*.apps.etlaq.sa` → server. See *KSA full-stack runtime* + `static-deploy-via-caddy.md`. |
| Netlify *(fallback only)* | static escape hatch (`STATIC_TARGET=netlify`) | Personal Access Token: https://app.netlify.com/user/applications#personal-access-tokens → `NETLIFY_API_KEY`. Not needed unless the fallback is enabled. |
| Vercel *(fallback only)* | full-stack escape hatch (`FULLSTACK_TARGET=vercel`) — **PDPL transfer** | Token: https://vercel.com/account/tokens → `VERCEL_TOKEN` (+ `VERCEL_TEAM_ID` if team-scoped). Don't enable in production. |

Both static and full-stack apps run **in-KSA by default** on the same VM. The
Netlify and Vercel fallbacks host outside KSA — Netlify only serves static files
(still Case-1 clean) but the Vercel fallback re-opens a PDPL transfer. See *Data
residency & PDPL*.

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
- A **full-stack app on the KSA runtime** calls the Supabase URL from its
  container — also the public URL, not localhost.

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
Full-stack apps build in a throwaway container on the KSA VM; static apps build
in the sandbox (`npm run build`) and are unpacked on the KSA VM. Nothing to
configure in a pipeline.

---

## Environment variable reference

| Var | Plane | Required for | Prod note |
|---|---|---|---|
| `KSA_APPS_DOMAIN` / `KSA_APPS_DIR` / `KSA_CADDY_APPS_DIR` / `KSA_RUNTIME_IMAGE` / `DOCKER_SOCK` | compute (KSA) | static + full-stack deploys | optional — defaults fit this server |
| `STATIC_TARGET` | compute | set `netlify` to use the fallback | leave unset in prod (default = KSA) |
| `NETLIFY_API_KEY` | compute | only for `STATIC_TARGET=netlify` fallback | any region |
| `FULLSTACK_TARGET` | compute | set `vercel` to use the fallback | leave unset in prod (PDPL) |
| `VERCEL_TOKEN` | compute | Vercel fallback only | PDPL transfer — fallback |
| `VERCEL_TEAM_ID` | compute | Vercel fallback (team tokens) | optional |
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
- [x] `NETLIFY_API_KEY` set *(now only used if `STATIC_TARGET=netlify`; static defaults to the KSA runtime)*.
- [x] `NEXT_PUBLIC_*` Supabase values are the public ones (baked into the image as build args).
- [x] Wildcard DNS `*.apps.etlaq.sa` → `149.104.105.231` — added; serves both static and full-stack KSA-runtime subdomains + their TLS certs.
- [ ] Validate a **static** publish end-to-end on the VM (needs sandbox + Docker socket + Caddy): `https://<slug>.apps.etlaq.sa` serves the SPA, deep-links fall back to `index.html`, assets load, TLS valid, and Caddy can read `/opt/etlaq-apps/<slug>/public`. See `static-deploy-via-caddy.md`.

## KSA full-stack runtime (how Publish hosts Next.js apps in-KSA)

`lib/deploy/ksa.ts` — the default full-stack target. Per app:

1. **Source** is written to `/opt/etlaq-apps/<slug>/app` (bind-mounted into the
   control app container; paths are sanitized against escape). Project creds go
   in `.env.production.local`, which outranks any env file the generated app
   ships and feeds both `next build` (NEXT_PUBLIC inlining) and `next start`.
2. **Build**: a one-shot `node:22-slim` container runs
   `npm install && next build` in that dir (uid 1001, 2 GB cap, 15 min timeout).
   `node_modules`/`.next`/`.npm-cache` persist across redeploys → incremental.
3. **Run**: container `etlaq-app-<slug>` runs `next start` on
   `127.0.0.1:<port>` (stable per app, range 34000–34999, reused on redeploy),
   `--restart unless-stopped`, 1 GB cap. Health = in-container HTTP probe.
4. **Route**: writes `/etc/caddy/apps.d/<slug>.caddy`
   (`<slug>.apps.etlaq.sa → 127.0.0.1:<port>`, with `tls { dns digitalocean }`);
   the `caddy-apps.path` systemd unit watches that dir and reloads Caddy. TLS is
   covered by the `*.apps.etlaq.sa` **wildcard cert** (DNS-01); the per-vhost
   `dns` directive keeps issuance off the HTTP-01 path (no handshake race).
   *(Static apps skip this step entirely — see the wildcard vhost below.)*

The control app drives all of this through the **Docker Engine API over the
mounted socket** (`lib/deploy/docker.ts`) — no docker CLI in the image, no new
npm deps. The subdomain slug is derived from the project name + id and recovered
from `projects.deploy_url` on redeploy, so no schema change was needed.

**Host prerequisites (all in place on this server):**
- wildcard DNS `*.apps.etlaq.sa` → the server *(the one manual step)*
- **wildcard TLS**: Caddy built with `caddy-dns/digitalocean` (`caddy add-package`),
  a DO API token at `/etc/caddy/caddy.env` (`chmod 600`, wired via a
  `caddy.service.d` drop-in that also drops `--environ` so the token never hits
  the journal), and a `*.apps.etlaq.sa` wildcard vhost that serves static slugs
  (`root * /opt/etlaq-apps/{labels.3}/public`) under one DNS-01 cert
- `/opt/etlaq-apps` and `/etc/caddy/apps.d` owned by uid 1001;
  `import /etc/caddy/apps.d/*.caddy` in the Caddyfile (with a `_keep.caddy`
  placeholder so the glob always matches)
- `caddy-apps.path` + `caddy-apps.service` systemd units (watch dir → reload)
- the control app container gets: docker socket (`--group-add <docker gid>`,
  999 here), `/opt/etlaq-apps`, and `/etc/caddy/apps.d` mounted — see the
  redeploy recipe below

**Security note:** mounting the docker socket makes the control app
root-equivalent on the host. Acceptable while control plane and runtime share
one VM; revisit (socket proxy or a separate runtime VM) when tenant load grows.

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
  -v /var/run/docker.sock:/var/run/docker.sock --group-add 999 \
  -v /opt/etlaq-apps:/opt/etlaq-apps \
  -v /etc/caddy/apps.d:/etc/caddy/apps.d \
  --restart unless-stopped open-love:paas
```

## Still open (product decisions, not blockers)

- ~~**Move the full-stack target into KSA (PDPL).**~~ Done 2026-07-03 — KSA
  runtime is the default (`lib/deploy/ksa.ts`); Vercel survives only behind
  `FULLSTACK_TARGET=vercel`.
- **`secretEnv` is intentionally empty.** Shipping the shared Supabase
  service-role key to a tenant app would break tenant isolation. A per-project
  scoped key must be minted before any server-only secret is injected.
- **Region latency.** Whichever full-stack host is used, keep it close to the KSA
  DB to cut app↔DB round-trips.

## Needs live-sandbox validation (typechecks, not runtime-tested)

- Next.js dev server behind the E2B/Vercel sandbox proxy (HMR/websocket, port
  5173 binding), `setupNextApp` scaffold + `npm install` in each sandbox, and a
  real Vercel full-stack deploy.
