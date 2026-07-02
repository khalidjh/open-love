# Spike: Better Auth vs. Zitadel, wired to self-hosted PostgREST

**Goal:** de-risk the multi-tenant auth choice before building. This is an
**integration + model-fit** spike (grounded in our stack); a live PoC of the winner is the
follow-up. See `docs/multi-tenant-auth-design.md` for the overall design.

## Method / what we're validating
1. **Model fit** — does the tool give *isolated per-app user pools with reusable emails*, or *one identity across apps*?
2. **PostgREST wiring** — how the tool's JWT gets trusted by our self-hosted PostgREST so the existing per-project schema + RLS data layer keeps working.
3. **Ops + effort + risk** for our stack (Next 15 / Node 20 / Drizzle / `postgres`; PostgREST + GoTrue run on the self-hosted Supabase box, not in this repo).

## The crux: how PostgREST authorizes
PostgREST verifies a JWT with `PGRST_JWT_SECRET`, maps the **`role` claim** to a Postgres
role, and exposes claims to RLS via `request.jwt.claims` (`auth.uid()` = `sub`). Two facts
decide everything:
- Today `PGRST_JWT_SECRET` = the **HS256 secret** (shared by GoTrue + the `anon`/`service_role` keys). Any HS256 token signed with it is trusted.
- `PGRST_JWT_SECRET` can instead be a **JWKS** (asymmetric), and a JWKS may hold **multiple keys** → we can trust an external issuer's RS256 keys **and** keep the HS256 `anon` key working by including it as an `oct` key. `PGRST_JWT_ROLE_CLAIM_KEY` can also point at a nested claim if a provider won't put `role` at the top level.

So integration = "make PostgREST trust the new issuer without breaking `anon`/`service_role`."

---

## ⚠️ Decisive finding: the two tools serve *different* tenancy models

- **Better Auth → one shared identity, many orgs.** Core `user.email` is **globally unique**; the `organization` plugin models *membership* (one user belongs to many orgs, like Slack workspaces). It does **not** give isolated per-app user pools — `sara@x.com` is a single account across every app. Getting true isolation means customizing the core user schema to `UNIQUE(tenant, email)` and tenant-scoping every uniqueness/lookup — i.e. hand-modifying a security-critical library, which defeats the point of adopting one.
- **Zitadel → organizations *are* isolated tenants.** A user belongs to one org; loginname/email is unique **within** an org, and the **same email can exist in different orgs**. This is exactly "App A's users are separate from App B's, emails reusable." Native fit. (Keycloak realms / SuperTokens tenants are the same family.)

**Therefore the choice is really a product question:**
- Want **per-app isolated user pools** (the thread's premise) → **Zitadel** (Better Auth is the wrong shape).
- Want **"Sign in with Etlaq"** — one identity users reuse across all their Etlaq apps → **Better Auth** is perfect and trivial.

## Path A — Better Auth (only if we accept shared "Sign in with Etlaq")
- **Runs in-process** in the Etlaq Next app, on our existing Postgres via Drizzle. No new service.
- **JWT plugin**: we control signing → sign **HS256 with the existing Supabase secret** and add `role:"authenticated"`, `sub`, and (if we namespace) `project_id`. → **PostgREST needs ZERO changes.** This is the lowest-friction integration by far.
- Tenancy: `organization` plugin = memberships, not isolation. Reusable-email-per-app ✗.
- Effort: **S** (days). Ops: **none new**. Risk: youngest project; and **model mismatch** with the isolation goal.

```ts
// better-auth: sign a Supabase-compatible token (HS256, existing secret)
jwt({ jwt: { issuer: "etlaq", audience: "authenticated",
  definePayload: (s) => ({ role: "authenticated", sub: s.user.id,
    email: s.user.email, project_id: s.session.activeOrganizationId }) },
  jwks: { keyPairConfig: { alg: "HS256" }, /* use SUPABASE_JWT_SECRET */ } })
// → app: createClient(url, anon, { db:{schema}, accessToken: () => authClient.getToken() })
// → PostgREST unchanged; RLS uses auth.uid()=sub.
```

## Path B — Zitadel (matches the isolation requirement)
- **Standalone Go service + its own Postgres** (separate container). New infra to run/patch.
- **Tenancy = organizations**: on auth-enable, `provisionProjectAuth(projectId)` calls Zitadel's **Management API** to create an **org per project** + an OIDC app; inject `VITE_AUTH_ISSUER` + `VITE_AUTH_CLIENT_ID`. Mirrors our DB provisioning.
- **Tokens are RS256**; Zitadel publishes a **JWKS** (`/.well-known/openid-configuration`). Wiring PostgREST:
  1. Set `PGRST_JWT_SECRET` to a **combined JWKS** = Zitadel's RSA public keys **+** an `oct` key holding the current Supabase HS256 secret (keeps `anon`/`service_role` alive). *(Server-side ops change on the Supabase box — main integration task.)*
  2. Zitadel tokens don't carry `role:"authenticated"` → add a **Zitadel Action** that injects `role:"authenticated"` (and maps `sub`) into the access token; or set `PGRST_JWT_ROLE_CLAIM_KEY` to a Zitadel claim.
  3. App uses an OIDC client (or Zitadel's SDK); feeds the access token to `supabase-js` `accessToken`.
- Effort: **M** (1–2 wks incl. PostgREST reconfig + Actions + provisioning). Ops: **+1 stateful service**. Risk: more moving parts; but hardened, proven multi-tenant.

## Scorecard

| Criterion | Better Auth | Zitadel |
|---|---|---|
| Isolated per-app pools + reusable email | ✗ (shared identity) | ✅ native (orgs) |
| PostgREST wiring | ✅ none (HS256 same secret) | ⚠️ JWKS reconfig + Action |
| New infra to run | ✅ none (in-process, our DB) | ✗ separate service + DB |
| Stack fit | ✅ Next/Drizzle native | ⚠️ external, OIDC |
| Maturity | ⚠️ young | ✅ battle-tested |
| Provision-per-project | custom | ✅ Management API |
| Effort | S | M |

## Recommendation
- If the product wants **isolated per-app auth** (what this thread is about): **Zitadel** is the correct model; Better Auth would require hacking its identity core. Accept the extra service + the one-time PostgREST/JWKS reconfig.
- If we'd actually be happy with **"Sign in with Etlaq"** (shared identity across a user's apps): **Better Auth**, and it's a near-trivial integration (HS256, no PostgREST change).

**So the real gate is the product decision, not the tech.** My lean: confirm we want isolation → go **Zitadel**; then the single thing to prove in a live PoC is **the combined-JWKS reconfig on PostgREST** (Zitadel RS256 + the HS256 `anon` key coexisting) — that's the only unknown; everything else is standard.

## Next step (live PoC of the winner)
1. Stand up Zitadel (docker) → create an org + OIDC app via Management API.
2. On the Supabase box: set `PGRST_JWT_SECRET` to the combined JWKS; add a Zitadel Action to inject `role:"authenticated"`.
3. Log in via Zitadel → call a project-schema table through PostgREST with the token → confirm RLS scopes to `sub`, and that a plain `anon` request still works.
4. If green: build `provisionProjectAuth` + injection + client SDK (design doc P1).
