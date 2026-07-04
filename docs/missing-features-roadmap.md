# Etlaq — Missing Critical Features Roadmap

_Snapshot: 2026-07-04, branch `feat/paas-phase1`. A gap analysis of the Etlaq PaaS (AI app-builder, non-technical users, data-in-KSA)._

The hard parts are built: multi-tenant isolation, per-app auth (Zitadel OIDC), per-project DBs (schema-per-project), KSA-resident deploy (Caddy static + Docker full-stack, wildcard TLS), code + chat persistence (`project_versions`, `messages`), dual Vite/Next.js generation. The gaps below are what's missing.

---

## Tier 1 — Existential (blockers for opening the doors / commercializing)

### 1. Usage metering + quotas + rate limiting  ⚠️ most urgent
- **Problem:** Any account can burn unlimited LLM tokens, spin up unlimited sandboxes, and deploy unlimited apps. No metering table, no rate limiting. A runaway prompt loop or abusive user directly costs money on every provider call.
- **Needed:** per-org metering of tokens / sandbox-minutes / deploys; enforceable caps; 429 past the limit. Build this _before_ billing — it's pure cost control.
- **Foundation for:** #2 (billing enforces the plan via these meters).

### 2. Billing
- **Problem:** No Stripe/Moyasar/Tap anywhere; no plan/subscription/quota tables. Blocks monetization entirely.
- **Needed:** subscription plans, checkout, plan→quota mapping (ties into #1).
- **KSA note:** prefer a **local processor (Moyasar / Tap / HyperPay)** over Stripe for data-residency/PDPL consistency with the rest of the stack.

---

## Tier 2 — Core UX gaps for non-technical users

### 3. Version history / rollback UI  ⭐ best effort-to-value
- **Problem:** `project_versions` immutable snapshots already exist and are persisted, but `restore` is only used for reload rehydration — there's no user-facing "undo my last change" / "go back to yesterday."
- **Needed:** visible version timeline + one-click revert. Cheap to build on existing data; huge safety net for non-technical users who will break their app with a bad prompt.

### 4. Social login + account recovery
- **Problem:** Platform auth is email/password only, despite OAuth callback plumbing already existing. Likely no password-reset / email-verification flow.
- **Needed:** "Continue with Google," password reset, email verification. Low effort, big signup-friction reduction.

### 5. Image / asset upload
- **Problem:** Generation is text-only — users can't add their logo, product photos, or brand images.
- **Needed:** asset upload + injection into generated apps. Blocks the "build my business site" use case.

### 6. Custom domains
- **Problem:** Apps live at `<slug>.apps.etlaq.sa`. Businesses want `theirbrand.sa`.
- **Needed:** custom-domain binding + verification. The wildcard-TLS Caddy setup makes this mostly a DNS/verification + per-vhost concern.

---

## Tier 3 — Growth & retention

- **Template / starter gallery** — curated starting points; a blank prompt is intimidating and converts worse.
- **Team collaboration UI** — `org_members` + roles exist in schema, but no invite/sharing UI.
- **Contact-form / email sending** for generated apps — nearly every site needs a working form.
- **Deployed-app analytics** — simple visitor counts give owners a reason to return.

---

## Cleanup / tech debt (not features)

- **Duplicate `v1`/`v2` routes** — `create-ai-sandbox`, `run-command`, `install-packages` — unfinished migration; consolidate on v2.
- **`app/builder/page.tsx`** — looks like a legacy parallel flow alongside `app/generation`; confirm and remove if dead.
- **KSA deploy targets** depend on external host infra (Docker socket, Caddy, wildcard DNS) — code exists but is environment-gated and not dev-runnable.
- **`tenant_ai` / `tenant_databases`** — labeled "Phase 2," newest/thinnest areas.

---

## Recommended order
1. **#1 Usage metering + quotas** — the only gap actively costing money now; foundation for billing.
2. **#3 Version rollback UI** — best effort-to-value; data model already exists.
3. **#2 Billing (Moyasar/Tap)** — pairs with #1's meters.
4. Then Tier 2 remainder (#4 social login → #5 assets → #6 domains) by friction impact.
