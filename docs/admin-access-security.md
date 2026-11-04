> First deployment preparation now supersedes earlier deployment/bootstrap descriptions: [current guide](first-production-deployment.md). Use `compose.coolify.yaml` alone. `USER_NAME` is Telegram account configuration; migrations do not run on API startup. Prior test results below describe their dated local verification.

# Admin access protection and security verification

Verified locally on November 3, 2026. This extends the existing Clerk/database authorization system. No alternative provider, public administrator registration, secret rotation, database migration, deployment, SSH access or container restart was introduced.

## Routes and indexing

- Dashboard: `/hub-console` (canonical static path `/hub-console/`).
- Login: `/hub-console/login`.
- Existing Google callback: `/hub-console/sso-callback`; Clerk's remaining verification flow: `/hub-console/verification`.
- Old `/admin` and `/admin/*` frontend URLs return a plain 404 with no redirect or console-path hint. Compatibility redirects were removed at the owner’s request. The administrative API deliberately remains `/api/admin/*`.

Vite, build assets, navigation, Google callback URLs, sign-out redirects and Hub's Caddy routing use the new prefix. An anonymous browser opening the dashboard changes to the login route after Clerk loads; this is the existing SPA architecture, not a server-side Clerk middleware redirect. The bare static dashboard URL first receives an HTTP 308 to its trailing-slash form. No dashboard component is rendered before backend approval of the current Clerk identity. OWNER-only sections have both frontend route guards and backend checks.

Admin HTML includes `noindex, nofollow, noarchive`; Caddy and development/preview responses add `X-Robots-Tag` on the actual admin pages, including the bare console URL. Protected API responses also carry `noindex`. Public `robots.txt` contains no console/admin path entries, so it does not advertise the entry point. There is no public sitemap listing the console. Obscurity and crawler controls do not provide authentication; static frontend assets are public, while protected data requires backend approval.

## Existing authentication strengthened

`createAdminAuth` continues to use the installed official `@clerk/backend` `verifyToken` and configured administrator origin. It now also retrieves the live Clerk session and identity through that SDK. Missing/forged/expired tokens, missing session IDs, pending setup sessions, ended/revoked/expired sessions, session/user mismatches, impersonation and banned/locked Clerk accounts fail closed. Lookup outages return a generic 503, not access.

A verified Google external account must match a verified email on the server-fetched Clerk user. Email normalization trims and lowercases consistently. The linked stable Clerk user ID is checked first. Email is used only for an approved record's initial association; that association remains conditional, transactional and audited. A disabled linked record cannot fall back to another email approval. No administrator is created by signing in.

Every protected administrative request reads the active PostgreSQL approval and its stored OWNER/ADMIN role. Browser roles, user IDs, email claims and local storage never supply administrative authority. Denials use a generic message without disclosing whether an email is approved. Missing/invalid authentication receives 401; unapproved/inactive identities or insufficient roles receive 403. The only public admin API is `GET /api/admin/config`, which returns the publishable key, configured flag and provider so the login UI can initialize.

Origin/CSRF protections remain: mutations require the exact configured origin and cross-site requests are rejected. A browser cannot attach a valid bearer session merely by following a link. The backend still verifies Clerk's authorized party, live session and database approval independently of UI visibility.

## Endpoint and role inspection

All paths below are under `/api/admin`. The central guard also covers the exact prefix and unknown endpoints before dispatch.

| Endpoints inspected | Required role after active authentication |
| --- | --- |
| `GET /me`, `/overview` | OWNER or ADMIN |
| `GET /videos`, `GET/POST /videos/:id` | OWNER or ADMIN |
| `GET /users`, `/users/:id`; `POST /users/:id/status` | OWNER or ADMIN |
| `GET /subscription-requests`, `GET/POST /subscription-requests/:id` | OWNER or ADMIN |
| `GET/POST /memberships`, `GET /memberships/:id`, `POST /memberships/:id/change`, `/memberships/:id/revoke` | OWNER or ADMIN |
| `GET /comments`, `POST /comments/:id` | OWNER or ADMIN |
| `GET /analytics`, `/audit-logs` | OWNER or ADMIN, preserving existing permissions |
| `GET /plans` | OWNER or ADMIN |
| `POST /plans/:id` | OWNER |
| `GET/POST /settings`, `/administrators`; `POST /administrators/:id` | OWNER |
| `GET /playback-sessions`; `POST /playback-sessions/:id/terminate` | OWNER or ADMIN |
| `GET /security-events`, `/operations` | OWNER |

The test matrix directly requests every protected list/detail/mutation route without credentials and with an unapproved Google-connected identity. It also checks ADMIN's allowed lists and OWNER-only endpoints using forged OWNER claims/payloads. These checks execute actual Node HTTP handlers, official RSA JWT verification and disposable PostgreSQL records. Clerk identity/session responses are test fixtures; they do not represent a newly performed human Google sign-in.

## OWNER identity, MFA and recovery

Read-only inspection found one existing active OWNER, already linked to a verified Google identity. Its identity, role, status, version and all other administrator records were hashed before and after the task and remained unchanged. Live Clerk session metadata also confirmed an active unexpired session. The last-active-OWNER protection is preserved and tested against both demotion and disabling.

**The actual OWNER has no MFA enrolled**, and the current Clerk instance is a development instance. No Clerk configuration was changed, as required by this task. The app shows the OWNER a truthful security reminder and opens Clerk's existing account-security UI. When the OWNER has MFA enrolled, the backend requires signed second-factor evidence (`fva`) in addition to an active session. Pending Clerk setup/MFA sessions are rejected. This is not a claim that the present OWNER is already MFA-protected.

Before deployment, the operator must enable the desired factors and required-MFA policy in the existing Clerk project and enroll the OWNER. Clerk documents authenticator/backup-code setup and pending MFA tasks; availability in production depends on the project's configuration/plan. No automatic paid-plan change or account-security change was made. [Clerk MFA configuration](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options#multi-factor-authentication), [signed factor/session claims](https://clerk.com/docs/guides/sessions/session-tokens).

Recovery uses the existing Google/Clerk identity, including provider recovery and securely retained Clerk backup codes after enrollment. Do not place recovery codes in Git, logs or application forms. An existing OWNER can approve another verified administrator through the existing OWNER-only interface. The final valid OWNER cannot be disabled/demoted through that interface. Changing `EMAIL` does not reset ownership because bootstrap remains one-time. A total identity loss requires a separately authorized, identity-verified operator recovery with backups; no public recovery endpoint, bypass token or replacement OWNER was created.

## Database, deployment and secret checks

- The configured database is external to this Compose project. Its actual client TLS socket was encrypted and its certificate validated. The pooled server's `pg_stat_ssl` flag alone was not used as proof of client encryption because pooling can terminate TLS before the database connection.
- Base and merged shared-Coolify Compose models validated. No database service or host PostgreSQL port is published. Only the API receives `DATA_BASE_URL`; web, proxy and Go do not receive database credentials. The base exposes only Hub's proxy ports 80/443; the shared-Coolify overlay exposes no host ports.
- All 10 public/admin build files and 199 tracked/new source files were scanned against configured credential values; no matching database URL, Clerk secret, service secret or private signing key was found. Frontend output contains no PostgreSQL connection URL/private PEM. Root secrets are ignored by Git and excluded from Docker build context. Publishable Clerk configuration is intentionally public.
- Both actual Hub Caddy configurations were exercised locally with canary tokens/cookies/referrers/OAuth query parameters. Access logs omitted them. The filter removes request URI/headers and response headers, covering callback tickets as well as Authorization/Cookie/Set-Cookie. Node authorization errors remain generic; a separate unauthorized-request log check did not print its credential canary.
- Root `.env`, Compose/overlay, all six migrations and existing administrator identities/roles were unchanged. No permissions were revoked and no live application records were reset.

**Remaining database deployment items:** the current database role is not a superuser but has `CREATEDB` and `CREATEROLE`. Separate least-privilege application credentials from migration/operator privileges before production. Existing permissions were preserved rather than changed during this task. Provider-side public reachability, IP allowlisting/private connectivity, database host listeners, Coolify project settings and the shared ingress were not inspected or changed. A successful authenticated TLS connection from this workstation is not proof that only the production backend can reach the database.

## Executed verification

| Check | Result |
| --- | --- |
| Full Node suite | Latest route follow-up: 92 passed, 0 failed; 10 opt-in database/FFmpeg/backup/Caddy checks skipped in this command |
| New admin HTTP/database security matrix | 6 passed, 0 failed; disposable schema and actual official JWT verification |
| Existing Module 4.2 management regression | Rerun: 2 passed, 0 failed, covering management, comments, memberships, settings, roles and analytics/calendar checks |
| Actual local dev/preview, Caddy routes and headless browser | Latest route follow-up: 3 passed, 0 failed; anonymous console-to-login navigation and Google button rendered; legacy-route 404/no-disclosure, noindex and assets and both proxy log filters exercised |
| Public/admin production builds | Passed with `/hub-console/` assets |
| Compose exposure models | Base and shared-Coolify merged models passed; no PostgreSQL/internal-backend host ports |
| Credential/build scan, actual TLS and record preservation | Passed, subject to the network/privilege limitations above |

The legacy-route follow-up initially exposed a Caddy fallback-ordering issue and a Vite middleware hook return-value issue. Both were fixed; real dev/preview, static/proxy and browser tests then passed with 404 responses and no console disclosure. Public robots.txt no longer lists either admin path. Authentication and database approval were unchanged.

The first management run received an unexpected dependency error on the public comment list; its follow-on assertion obscured the HTTP status. The fixture now checks that status explicitly, and the complete isolated rerun passed. No authorization rule was weakened to pass the test. The first local route/browser test harness had cleanup/wait problems; bounded requests and test-process cleanup were corrected and the complete rerun passed. The normal browser automation helper failed initialization twice; a fresh headless Chrome profile was used instead. Its screenshot is `.local/qa/admin-login.png`.

Reproduce with:

```powershell
node --test tests/*.test.mjs
$env:RUN_DB_TESTS='1'
node --test --test-concurrency=1 tests/admin-security-database.test.mjs tests/module42-database.test.mjs
$env:RUN_CADDY_TESTS='1'
$env:RUN_BROWSER_TESTS='1'
node --test tests/admin-routing.test.mjs
```

The routing check needs built frontend assets, a local Caddy binary (`CADDY_PATH`, default `.tools/caddy/caddy.exe`) and Chrome (`CHROME_PATH`, default standard Windows installation). These are local QA tools, not added application dependencies. No Google authentication dialog was automated.

## Before production

Complete OWNER MFA enrollment/recovery, verify the existing Clerk project's production configuration and callback/origin settings for the deployed hostname, review database network restrictions/least-privilege credentials, and perform a human OWNER/ADMIN Google-login/logout check through the real HTTPS ingress. The new backend's authorization and role checks passed locally, but those live-production checks were not performed. No deployment, container restart, VPS access or load testing occurred, and unrelated projects/shared ingress remain untouched.

## Files changed in this task

Backend: `services/api/src/admin-auth.mjs`, `application.mjs`, `server.mjs`. Frontend: `apps/admin/src/Module42.jsx`, `apps/admin/vite.config.mjs`, `apps/admin/index.html`, `apps/web/public/robots.txt`. Hub routing/build: `infrastructure/docker/Caddyfile`, `Caddyfile.coolify`, `static.Caddyfile`, `web.Dockerfile`. Verification: `tests/admin-access.test.mjs`, `admin-security-database.test.mjs`, `admin-routing.test.mjs`, existing `module41-domain.test.mjs` / `module42-database.test.mjs` fixtures, and `scripts/test-database.mjs`. Documentation: `README.md`, `docs/automatic-streaming.md`, `docs/api/contracts.md`, `docs/module42.md` and this report. No application dependencies, environment files or migrations were changed.
