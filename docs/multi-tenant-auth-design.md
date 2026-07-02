# Multi-Tenant Auth for Etlaq-built apps — Design

**Status:** proposed · **Author:** Etlaq · **Depends on:** self-hosted Supabase, per-project schema provisioning

## TL;DR

Give every generated app its **own isolated, secure user pool** without spinning up
infra per app. Because we **self-host Supabase, we control the JWT secret** — so we run
our own small **multi-tenant "Etlaq Auth"** service that stores users keyed by
`(project_id, email)` and **mints Supabase-compatible JWTs**. The existing data layer
(PostgREST + per-project schema + RLS) already trusts those JWTs, so we only replace the
*identity provider* (GoTrue), not the data stack.

Result: **isolated** per app · **reusable emails** across apps · **secure** (no crypto in
the static app) · **zero-config** for non-technical users (provisioned + injected exactly
like the database).

---

## Goals / Non-goals

**Goals**
- Each app authenticates only *its own* users; App A cannot see App B's users.
- The same email can register in different apps (no global-unique-email wall).
- Passwords/sessions handled by a proven, server-side implementation — never in the static app.
- Zero-config: when the AI detects the app needs auth, we provision + inject, like the DB.
- Reuse the existing Supabase data layer (PostgREST, schemas, RLS) unchanged.

**Non-goals (v1)**
- Social/OAuth login (phase 3).
- SSO/SAML, org/team management inside generated apps.
- Migrating the current shared-Supabase-Auth apps (phase 4).

## Constraints (from the codebase)

- **Generated apps are static** (Vite → Netlify). No server → auth must be a *service the app calls*; no secrets can live in the app.
- **Self-hosted Supabase, single instance.** Per-project = a Postgres **schema** exposed via PostgREST (`alter role authenticator set pgrst.db_schemas=...`, see `lib/db/provision-schema.ts`). `auth.users` (GoTrue) is **global + email-unique** → unusable for isolated multi-tenant auth.
- **We hold the instance secrets** — `SUPABASE_SERVICE_ROLE_KEY` today; we can also hold `SUPABASE_JWT_SECRET` (the HS256 secret GoTrue **and PostgREST** use). PostgREST authorizes **any** HS256 JWT signed with that secret and reads its `role`/`sub`/custom claims.
- **Control plane** is Postgres + Drizzle (`orgs`, `projects`, `tenantDatabases`, …) with an existing provisioning pattern to copy.
- Creds are injected into the sandbox `.env` and **baked into the build**, so `VITE_*` values reach Netlify automatically.

## Chosen architecture — "Etlaq Auth", a JWT-minting identity service

```
 Generated app (static, Netlify)                 Etlaq platform (server)          Self-hosted Supabase
 ┌───────────────────────────┐   signUp/signIn   ┌──────────────────────┐        ┌─────────────────────┐
 │ etlaq-auth-client         │ ────────────────▶ │ /api/app-auth/*       │        │  PostgREST          │
 │  - stores tokens          │ ◀──────────────── │  (Etlaq Auth service) │        │   trusts HS256 JWT  │
 │  - accessToken() provider │   {access,refresh}│  - argon2id passwords │        │   signed w/ JWT sec │
 └────────────┬──────────────┘                   │  - mints Supabase JWT │        │  RLS on project     │
              │ Authorization: Bearer <JWT>       │    (HS256, JWT_SECRET)│        │  schema tables      │
              ▼                                   │  - users(project,email)│       └─────────▲───────────┘
        supabase-js (data)  ───────────────────────────────────────────────────────────────┘
              (queries the project's own schema; RLS scopes rows by sub/project_id)
```

**Flow**
1. App calls `POST {VITE_ETLAQ_AUTH_URL}/signup|login` with `{ app_id, email, password }`.
2. Etlaq Auth verifies against `app_users` where `project_id = app_id` (argon2id).
3. On success it **mints a Supabase-compatible access token** (HS256, signed with `SUPABASE_JWT_SECRET`) and a refresh token.
4. App configures `supabase-js` with `accessToken: () => client.getAccessToken()`. Every data request carries the Etlaq-issued JWT.
5. PostgREST validates the signature, applies `role=authenticated`, and RLS scopes rows by `auth.uid()` (`sub`) — inside the app's **own schema**.

**Why this is the right fit for self-hosted Supabase:** we own the JWT secret, so we can be a *second issuer* PostgREST already trusts. We reuse PostgREST + schemas + RLS verbatim and swap only GoTrue. (This is not safe/possible on Supabase Cloud, but is clean self-hosted.)

## Data model (new control-plane tables, Drizzle)

```ts
// One row per project that has auth enabled
tenantAuth = {
  id, projectId (fk, unique), appId (public, = projectId or a random public id),
  status: 'active' | 'disabled',
  allowedOrigins: text[]        // Netlify prod + preview domains for CORS
  createdAt, updatedAt,
}

// The isolated user pool — emails reusable ACROSS projects
appUsers = {
  id (uuid), projectId (fk),
  email (citext), passwordHash (argon2id),
  emailVerified (bool), metadata (jsonb),
  createdAt, updatedAt,
  UNIQUE (projectId, lower(email))   // ← the whole point
}

// Rotatable, revocable refresh tokens (store only a hash)
appAuthSessions = {
  id, userId (fk), projectId, refreshTokenHash,
  userAgent, ip, expiresAt, revokedAt, createdAt,
}

// Short-lived email tokens (verify / reset), hashed
appAuthTokens = { id, userId, projectId, kind:'verify'|'reset', tokenHash, expiresAt, usedAt }
```

## Token design

**Access token** — HS256, signed with `SUPABASE_JWT_SECRET`, TTL ~60 min:
```json
{
  "iss": "etlaq-auth",
  "aud": "authenticated",
  "role": "authenticated",        // PostgREST → sets DB role
  "sub": "<appUsers.id>",         // RLS auth.uid()
  "email": "user@example.com",
  "project_id": "<projectId>",    // extra guard for RLS/PostgREST filters
  "schema": "<project schema>",
  "iat": ..., "exp": ...
}
```
**Refresh token** — opaque random (256-bit), stored **hashed**, rotated on every use,
revocable per session. Access tokens are short so a leaked/rotated key window is small.

## Auth API (Etlaq server: `app/api/app-auth/*`)

| Endpoint | Purpose |
|---|---|
| `POST /signup` | create `app_users` row (scoped to `app_id`), send verify email, return tokens |
| `POST /login` | verify argon2id, return `{access, refresh}` |
| `POST /token` | exchange refresh → new access (+ rotate refresh) |
| `POST /logout` | revoke session |
| `GET /me` | resolve current user from access token |
| `POST /verify-email`, `POST /forgot`, `POST /reset` | email flows |

All endpoints require a valid `app_id`; every query is filtered by `project_id`. CORS
restricted to the project's `allowedOrigins`.

## Provisioning (mirror `provisionProjectSchema`)

`provisionProjectAuth(projectId)` — idempotent, triggered when the AI detects an auth need
(same hook as DB auto-detect):
1. Upsert `tenantAuth` (create `appId`, default allowed origins = current sandbox + future Netlify domain).
2. Apply **RLS templates** to the project's user-owned tables (owner = `auth.uid()`).
3. **Inject into the sandbox** (extends the existing `injectIntoSandbox`):
   ```
   VITE_ETLAQ_AUTH_URL=https://app.etlaq.io/api/app-auth
   VITE_ETLAQ_AUTH_APP_ID=<appId>
   # (VITE_SUPABASE_URL / ANON_KEY / SCHEMA already injected for data)
   ```
   + drop a tiny `src/lib/etlaqAuth.ts` client and wire the Supabase client's `accessToken`.
4. Steer the AI to use `etlaqAuth.signUp/signIn` (not `supabase.auth`).

Deploy carries `VITE_ETLAQ_AUTH_*` to Netlify automatically (baked at build). The JWT
secret + password hashes **never** leave Etlaq's server.

## Generated-app integration

- **Client SDK** (~100 lines, injected): `signUp/signIn/signOut/getSession/getAccessToken`; persists tokens (localStorage), auto-refreshes.
- **Data**: `createClient(url, anonKey, { db:{ schema }, accessToken: () => etlaqAuth.getAccessToken() })`. supabase-js attaches the token per request.
- **RLS template** (per user-owned table):
  ```sql
  alter table <schema>.<t> enable row level security;
  create policy owner_rw on <schema>.<t>
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  ```

## Security requirements

- **argon2id** password hashing (`@node-rs/argon2`); **jose** for JWT.
- Access-token TTL ≤ 60 min; refresh rotation + server-side revocation.
- Rate-limit + lockout on `/login`, `/signup`, `/forgot`.
- Email verification + password reset via existing SMTP (reuse Etlaq's GoTrue SMTP config).
- `SUPABASE_JWT_SECRET` is **server-only**, high-value (compromise = trust-anything at PostgREST); rotate on a schedule, monitor. Short access TTL bounds exposure.
- CORS locked to per-project `allowedOrigins`; reject unknown `app_id`.
- Isolation is enforced three ways: per-project **schema** + **RLS on `sub`** + **`project_id` claim**.

## Engine choice — build vs. library vs. buy

- **Recommended: lean custom service (`jose` + `@node-rs/argon2`) on our Drizzle control plane.** The crux — *minting PostgREST-trusted JWTs keyed by tenant* — is exactly what off-the-shelf libs don't do. Scope is ~6 endpoints; native to our stack; fully auditable.
- **Better Auth / Lucia**: great for sessions/OAuth/plugins, but their session model isn't Supabase-JWT-shaped — we'd still bolt on the JWT-minting layer. Revisit when we want social login (phase 3).
- **Clerk / WorkOS / Stytch (buy)**: offloads security; integrate by pointing PostgREST at their **JWKS** and provisioning a tenant/org per project. Viable, but adds per-MAU cost and doesn't leverage the self-hosted instance we already run. Keep as a fallback if we don't want to own auth.

## Rollout

- **P1 (MVP):** control-plane tables + email/password API + JWT minting + provisioning + client SDK + RLS templates. Isolated auth works end-to-end.
- **P2:** email verification, password reset, rate limiting, refresh rotation, allowed-origin management for Netlify domains.
- **P3:** OAuth (Google/GitHub) per app, magic links.
- **P4:** migration tool for existing shared-Supabase-Auth apps.

## Risks & open questions

- **JWT-secret blast radius** — anyone with it can mint trusted tokens. Server-only, rotate, short TTLs, alerting.
- **Secret rotation** invalidates live tokens → rely on short access TTL + refresh to re-mint; plan a dual-secret window if PostgREST supports it.
- **Email deliverability** — depends on SMTP; reuse the instance's config.
- **CORS for arbitrary Netlify domains** — need per-project origin registration at deploy time.
- **We now own security-critical code** — commit to patching, tests, and a periodic review.
- Open: one `appId == projectId` (simplest) vs. a separate rotating public id? Start with `projectId`.
```
