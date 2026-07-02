# PoC Runbook — Zitadel → self-hosted PostgREST (isolated per-app auth)

**Decision:** isolated per-app auth → **Zitadel** (see spike). This runbook validates the
**one real unknown**: PostgREST trusting Zitadel's RS256 tokens **and** the existing HS256
`anon`/`service_role` keys at the same time. Do this before writing integration code.

> Runs against **your** self-hosted Supabase host (you edit PostgREST env + restart) and a
> local Zitadel. Not runnable from the app repo. Use `! <cmd>` to run steps in-session.

## Prereqs
- Docker.
- Shell access to the self-hosted Supabase box (to set `PGRST_JWT_SECRET` + restart PostgREST).
- The instance **HS256 JWT secret** (`GOTRUE_JWT_SECRET` / `PGRST_JWT_SECRET` on that box).
- A test project **schema** already provisioned + one user-owned table with RLS `using (user_id = auth.uid())`.

## 1 — Run Zitadel + a service account (PAT)
```bash
# minimal single-container Zitadel (Postgres embedded via compose is fine too)
docker run -d --name zitadel -p 8080:8080 \
  ghcr.io/zitadel/zitadel:latest start-from-init \
  --masterkey "MasterkeyNeedsToHave32Characters" --tlsMode disabled
# Console: http://localhost:8080  (create admin, then a Service User + PAT for the Mgmt API)
export ZITADEL=http://localhost:8080  ZTOKEN=<service-user-PAT>
```

## 2 — Create a test org + OIDC app + user (Management API)
```bash
# org (= one project/tenant)
curl -s $ZITADEL/management/v1/orgs -H "Authorization: Bearer $ZTOKEN" \
  -H "Content-Type: application/json" -d '{"name":"proj_test"}'      # → returns org id
# OIDC app (public, PKCE) under that org, + a human user with a password
# (see Zitadel Mgmt API: /projects, /apps/oidc, /users/human) — capture clientId
```

## 3 — Inject `role:"authenticated"` into the token
Zitadel tokens don't carry PostgREST's `role`. Either:
- **Action** (Zitadel Actions v2, "complement token") that adds claim `role="authenticated"` (and keep `sub` = user id), **or**
- leave a custom claim and set `PGRST_JWT_ROLE_CLAIM_KEY=".<claim>"` on PostgREST.

## 4 — Build the **combined JWKS** (the crux)
```bash
# Zitadel public keys
curl -s $ZITADEL/oauth/v2/keys > zitadel-jwks.json
# add an oct key for the Supabase HS256 secret so anon/service_role still verify:
#   { "kty":"oct", "k":"<base64url(HS256_SECRET)>", "alg":"HS256",
#     "kid":"supabase-hs256", "use":"sig" }
# merge both key sets into one { "keys": [ ...zitadel RSA..., ...oct... ] }  -> combined-jwks.json
```

## 5 — Point PostgREST at the combined JWKS (on the Supabase box)
```bash
# set PGRST_JWT_SECRET to the combined JWKS JSON (string), then restart PostgREST
#   e.g. docker compose exec: update env, `docker restart <supabase-rest>`
# keep PGRST_JWT_AUD if the instance uses it; optionally PGRST_JWT_ROLE_CLAIM_KEY
```

## 6 — Get a Zitadel access token for the test user
Log in via the OIDC app (auth-code+PKCE in a scratch page, or password grant for the PoC) →
capture the **access token** (RS256, `sub` = user id, `role="authenticated"`).

## 7 — Validate (the acceptance test)
```bash
SB=https://<your-supabase>   ANON=<supabase anon key>   ZJWT=<zitadel access token>   SCHEMA=<proj schema>
# (a) Zitadel token authorizes + RLS scopes rows to sub:
curl -s "$SB/rest/v1/<table>?select=*" -H "apikey: $ANON" \
  -H "Authorization: Bearer $ZJWT" -H "Accept-Profile: $SCHEMA"
# (b) plain anon STILL works (HS256 key survived the switch):
curl -s "$SB/rest/v1/<public_table>?select=*" -H "apikey: $ANON" -H "Accept-Profile: $SCHEMA"
```

### ✅ Success criteria
- (a) returns only the test user's rows (RLS on `auth.uid()`), **and**
- (b) still returns for anon.

→ combined-JWKS validated. If (b) breaks, the `oct` key/`kid` is wrong; if (a) 401s, check
`role` claim + JWKS `kid`/alg matching. Once green, proceed to Phase 1.

---

## Phase 1 build tickets (repo-side, after PoC is green)
1. **Drizzle `tenantAuth` table** (`projectId` unique, `orgId`, `clientId`, `issuer`, `allowedOrigins[]`, `status`) + migration.
2. **`lib/auth/zitadel.ts`** — Mgmt API client: `createOrg`, `createOidcApp`, `ensureRoleAction`.
3. **`provisionProjectAuth(projectId)`** + **`app/api/projects/[id]/auth/route.ts`** (POST provision / GET creds) — mirror `app/api/projects/[id]/database/route.ts`; store creds encrypted.
4. **Sandbox injection** — extend `injectIntoSandbox`: write `VITE_AUTH_ISSUER`, `VITE_AUTH_CLIENT_ID`; install `oidc-client-ts`; drop `src/lib/etlaqAuth.ts` (signIn/signUp/getAccessToken) + wire `createClient(..., { accessToken })`.
5. **RLS templates** applied to user-owned tables on provision.
6. **AI steering** — system-prompt guidance to use `etlaqAuth.*` (never `supabase.auth`) when auth is needed; add auth to the auto-detect that already exists for the DB.
7. **Deploy** — register the Netlify domain(s) as Zitadel app redirect URIs + PostgREST/CORS allowed origins on deploy.
