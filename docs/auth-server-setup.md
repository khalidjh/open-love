# Etlaq — Isolated Auth: Server Setup Runbook

Run this **on the server** (SSH). It sets up the one-time infrastructure that Etlaq's
per-project auth needs: a **Zitadel** instance, a Management API token, a token **role**
claim, and a **PostgREST** reconfig so your self-hosted Supabase trusts Zitadel's tokens
**and** keeps the existing `anon`/`service_role` keys working.

> The combined-JWKS mechanism in Part E was **already validated locally** — this applies the
> same, proven config to production. Nothing here changes per project; Etlaq auto-provisions
> each project (org + OIDC app) once Part C is done.

> **Production values (2026-07-03):** `AUTH_DOMAIN` = `id.etlaq.sa` · `SUPABASE_HOST` =
> `https://auth.etlaq.sa` · `SUPABASE_DIR` = `/opt/supabase-selfhost/docker` · `ETLAQ_ENV` =
> `/opt/open-love/.env.local`. Zitadel runs from `/opt/zitadel` (PAT at
> `/opt/zitadel/pat/zitadel-pat`, masterkey in `/opt/zitadel/.env`, bound to `127.0.0.1:8080`
> behind Caddy).
>
> **Status: Parts A–F completed 2026-07-03.** The `add_role` action (id `380144490909794307`)
> is wired to Complement-Token triggers 4+5 via the Management API. Two deviations from the
> steps below, both intentional:
> 1. **No compose edit for PostgREST** — the supabase compose already reads
>    `PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}`, so the combined JWKS lives in
>    `SUPABASE_DIR/.env` as `JWT_JWKS=...` (backup: `.env.bak-jwks`). Rollback = remove that
>    line and `docker compose up -d rest`.
> 2. **`PGRST_JWT_AUD` deliberately NOT set** — Zitadel JWT access tokens carry the client/
>    project IDs in `aud`, never `authenticated`, so enforcing that aud would reject every
>    Zitadel token and defeat the whole setup. GoTrue/anon behavior is unchanged either way
>    (verified: anon + service_role both 200 after the swap).
>
> Ops notes: the Zitadel container runs as uid 1000 — the bind-mounted `./pat` dir must be
> writable by it *before first start*, or setup dies mid-init ("permission denied" then
> `Instance.Domain.AlreadyExists` on every restart; fix = fresh `down -v` after `chown`).
> `zdb` has a pg_isready healthcheck + `depends_on: condition: service_healthy` for the same
> reason. If v1 Actions are ever migrated to v2, replicate the `role` claim before removing.

## Fill these in first

| Placeholder | Meaning | Example |
|---|---|---|
| `AUTH_DOMAIN` | public domain for Zitadel (= OIDC issuer) | `auth.etlaq.io` |
| `SUPABASE_HOST` | base URL of your self-hosted Supabase | `https://db.etlaq.io` |
| `SUPABASE_HS256_SECRET` | your GoTrue/PostgREST JWT secret (raw HS256) | from Supabase `.env` `JWT_SECRET` |
| `SUPABASE_ANON_KEY` | the public anon key | from Supabase `.env` `ANON_KEY` |
| `SUPABASE_DIR` | dir with your Supabase `docker-compose.yml` | `/opt/supabase/docker` |
| `ETLAQ_ENV` | where Etlaq's env vars live | Etlaq host `.env` / secrets store |

Requirements: Docker + Docker Compose, Node 18+, a TLS reverse proxy (Caddy/nginx) or a
platform that terminates TLS for `AUTH_DOMAIN`.

---

## Part A — Host Zitadel

```bash
mkdir -p /opt/zitadel && cd /opt/zitadel
cat > docker-compose.yml <<'YAML'
services:
  zitadel:
    image: ghcr.io/zitadel/zitadel:latest
    command: 'start-from-init --masterkey "REPLACE_WITH_32_CHAR_MASTERKEY______" --tlsMode external'
    environment:
      ZITADEL_EXTERNALDOMAIN: AUTH_DOMAIN         # <-- fill
      ZITADEL_EXTERNALPORT: 443
      ZITADEL_EXTERNALSECURE: "true"
      ZITADEL_DATABASE_POSTGRES_HOST: zdb
      ZITADEL_DATABASE_POSTGRES_PORT: 5432
      ZITADEL_DATABASE_POSTGRES_DATABASE: zitadel
      ZITADEL_DATABASE_POSTGRES_USER_USERNAME: zitadel
      ZITADEL_DATABASE_POSTGRES_USER_PASSWORD: zitadelpw
      ZITADEL_DATABASE_POSTGRES_USER_SSL_MODE: disable
      ZITADEL_DATABASE_POSTGRES_ADMIN_USERNAME: postgres
      ZITADEL_DATABASE_POSTGRES_ADMIN_PASSWORD: postgrespw
      ZITADEL_DATABASE_POSTGRES_ADMIN_SSL_MODE: disable
      # --- headless Management API token (writes a PAT to a file) ---
      ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_USERNAME: etlaq-admin
      ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_NAME: etlaq-admin
      ZITADEL_FIRSTINSTANCE_ORG_MACHINE_PAT_EXPIRATIONDATE: "2100-01-01T00:00:00Z"
      ZITADEL_FIRSTINSTANCE_PATPATH: /pat/zitadel-pat
    volumes:
      - ./pat:/pat
    depends_on: [zdb]
    ports:
      - "8080:8080"            # put your TLS proxy in front of this on AUTH_DOMAIN:443
  zdb:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgrespw
      POSTGRES_DB: zitadel
    volumes:
      - zdata:/var/lib/postgresql/data
volumes:
  zdata:
YAML

# fill AUTH_DOMAIN + a 32-char masterkey, then:
docker compose up -d
# wait ~30-60s for init, then the Management API PAT is here:
cat ./pat/zitadel-pat        # <-- this is ZITADEL_TOKEN
```
Point your TLS proxy so `https://AUTH_DOMAIN` → `localhost:8080`. Confirm:
```bash
curl -s https://AUTH_DOMAIN/.well-known/openid-configuration | head -c 200
```

> Fallback (if `FIRSTINSTANCE_PATPATH` isn't supported by your image version): open the
> console at `https://AUTH_DOMAIN`, log in as the printed admin, create a **Service User**
> with org-management rights, and generate a **PAT** in the console. Use that as `ZITADEL_TOKEN`.

## Part B — sanity check the token
```bash
export ZITADEL_URL=https://AUTH_DOMAIN
export ZITADEL_TOKEN="$(cat /opt/zitadel/pat/zitadel-pat)"
curl -s -H "Authorization: Bearer $ZITADEL_TOKEN" "$ZITADEL_URL/management/v1/orgs/me" | head -c 200
# expect JSON about the org (not 401)
```

## Part C — give the two values to Etlaq
Set in `ETLAQ_ENV` (Etlaq's deployment env) and redeploy/restart Etlaq:
```
ZITADEL_URL=https://AUTH_DOMAIN
ZITADEL_TOKEN=<contents of /opt/zitadel/pat/zitadel-pat>
```
This turns on per-project auth provisioning in Etlaq.

## Part D — add the `role` claim (Zitadel Action)
PostgREST picks the DB role from the token's `role` claim. Add an Action that injects it.

**Console path (v1 Actions):** Zitadel Console → your instance's default org → **Actions** →
create action `add_role`:
```javascript
function add_role(ctx, api) {
  api.v1.claims.setClaim('role', 'authenticated')
}
```
Then **Flows** → Flow type **Complement Token** → add trigger **Pre Access Token creation**
(and **Pre Userinfo creation**) → action `add_role`.

> If your Zitadel uses Actions v2 (API), create the equivalent "complement token" action via
> the API. Net effect required: every **access token** carries `role: "authenticated"`.

## Part E — make PostgREST trust Zitadel + keep anon working (the one prod-data change)

1) Build the **combined JWKS** (Zitadel RS256 keys + an `oct` key for your HS256 secret):
```bash
cat > /tmp/build-combined-jwks.mjs <<'JS'
const ZITADEL_URL = process.env.ZITADEL_URL;
const HS = process.env.SUPABASE_HS256_SECRET;
if (!ZITADEL_URL || !HS) { console.error('set ZITADEL_URL and SUPABASE_HS256_SECRET'); process.exit(1); }
const res = await fetch(ZITADEL_URL.replace(/\/$/, '') + '/oauth/v2/keys');
if (!res.ok) { console.error('failed to fetch Zitadel JWKS:', res.status); process.exit(1); }
const zjwks = await res.json();
const oct = { kty: 'oct', k: Buffer.from(HS).toString('base64url'), alg: 'HS256', kid: 'supabase-hs256', use: 'sig' };
console.log(JSON.stringify({ keys: [...(zjwks.keys || []), oct] }));
JS

ZITADEL_URL=https://AUTH_DOMAIN \
SUPABASE_HS256_SECRET='<SUPABASE_HS256_SECRET>' \
node /tmp/build-combined-jwks.mjs > /tmp/combined-jwks.json
cat /tmp/combined-jwks.json   # single-line JSON: {"keys":[ ...RSA..., {"kty":"oct",...} ]}
```

2) Point **only PostgREST** at the JWKS (GoTrue keeps signing with the raw HS256 secret):
   In `SUPABASE_DIR/docker-compose.yml`, on the **`rest`** service, set:
```yaml
    environment:
      PGRST_JWT_SECRET: '<paste the single-line contents of /tmp/combined-jwks.json>'
      PGRST_JWT_AUD: authenticated
      # leave everything else as-is; do NOT change GOTRUE_JWT_SECRET
```
> Important: do **not** change the shared `JWT_SECRET` that GoTrue reads — only the `rest`
> service's `PGRST_JWT_SECRET`. Back up the file first.

3) Restart just PostgREST:
```bash
cd SUPABASE_DIR
cp docker-compose.yml docker-compose.yml.bak
# (edit the rest service as above)
docker compose up -d rest
docker compose logs --tail=20 rest   # expect NO "JWTSecret"/config errors
```

## Part F — verify (run on the server)

```bash
export SB=SUPABASE_HOST ANON='<SUPABASE_ANON_KEY>'
# (1) anon/service_role STILL work after the swap — the critical safety check:
curl -s -o /dev/null -w "anon: %{http_code}\n" "$SB/rest/v1/" -H "apikey: $ANON"
#     expect 200 (or the usual PostgREST root). If 401 -> the oct key/kid is wrong; revert.
```
The full **authenticated** path (a Zitadel user token returning only that user's rows via
RLS) is exercised the first time a generated app logs in — that half of the mechanism was
already proven locally, so this server step only needs to confirm **anon didn't break**.

### ✅ Done when
- `Part B` returns org JSON (token valid).
- Console shows the `add_role` action on the Complement-Token flow.
- `Part F (1)` returns 200 (anon still works with the combined JWKS).
- Etlaq has `ZITADEL_URL` + `ZITADEL_TOKEN` set.

Then tell Etlaq (me): I'll run `provisionProjectAuth` against the live Zitadel, wire
auto-detect + AI steering, and generate the `/auth/callback` page in built apps.

## Rollback (if anything breaks)
```bash
cd SUPABASE_DIR && cp docker-compose.yml.bak docker-compose.yml && docker compose up -d rest
```
This restores the original `PGRST_JWT_SECRET`; nothing else was touched.
