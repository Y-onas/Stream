# First production preparation — verification and handoff

Date: 2026-11-03. **Preparation completed locally; release prerequisites remain. No VPS access or deployment occurred.** Follow [the deployment guide](first-production-deployment.md) for operator commands and exact variable tables.

## Prepared structure

Four containers serve the existing architecture: public/admin React together in `web`, Node/Prisma in `api`, Telegram discovery/original-file delivery in `stream-go`, and the Hub-specific `proxy`. PostgreSQL remains the selected external database. No database, cache, transcoder, download service or additional Telegram service was added.

`compose.coolify.yaml` is a complete definition used **alone**, with no host-port publications. Only proxy internal port 80 receives a Coolify domain. The project-scoped bridge provides necessary outbound connectivity and private service communication. The standalone-host `compose.yaml` still publishes 80/443 and must not be merged into the shared Coolify deployment.

Default CPU/RAM quotas and bitrate throttling remain absent. `compose.resources.yaml` provides optional explicit allocations for all four containers, with eight required operator-supplied inputs when enabled. It does not enable application-wide viewer/reservation limits. Existing per-account VIP enforcement, signed grants, authorization renewal, session ownership/cleanup, bounded reads and cancellation remain in place.

## Runtime configuration and persistence

The single root `.env.example` is the central template; duplicate frontend/API/Go templates were unnecessary. [Guide section 4](first-production-deployment.md#4-environment-template-and-all-runtime-variables) documents each variable's exact name, owning service, requirement, secret status and timing. Compose supplies internal addresses; both frontends use same-origin API requests and runtime Clerk configuration, so they need no secret build arguments or rebuild to change a hostname.

All four Telegram values are runtime-required with no test fallback:

| Variable | Validation |
| --- | --- |
| `TELEGRAM_API_ID` | Positive 32-bit app ID |
| `TELEGRAM_API_HASH` | 32 hexadecimal characters |
| `TELEGRAM_SOURCE` | Nonblank, bounded display title without control characters, matching existing source discovery |
| `USER_NAME` | Primary Telegram username, optionally prefixed with `@`; checked against the authenticated account |

Missing/invalid values report field names without echoing supplied credentials. The exact names `DATA_BASE_URL`, existing Clerk keys and signing/session variables are preserved. `USER_NAME` is passed only to Go and no longer used as an administrator display name. Production API preflight checks HTTPS origins, external database TLS settings, independent service secrets, production Clerk key prefixes and matching signing keys. `-check-config` / `--check-config` support local validation without contacting Telegram or running migrations.

The `telegram_session` volume mounts at `/sessions`; `catalogue_state` mounts at `/state`. Coolify scopes actual volume names by the resource/project. Go runs as UID/GID 10001, with one writer for both session and checkpoint. The guide uses the existing interactive CLI, hidden authentication prompts and stopped-service provisioning; it introduces no browser/remote authentication flow. Private signing material is read-only in API only; the public key is read-only in API and Go. No video bytes are persistently cached.

API startup no longer executes migrations. The explicit `node scripts/db-migrate.mjs` job runs locked Prisma 7.10.1 `migrate deploy` plus idempotent package/first-OWNER initialization. Missing initial `EMAIL` is an explicit failure for an administrator-empty database. Existing administrators are not renamed/recreated. API liveness can be healthy before initialization; integrated `/readyz` remains unsuccessful until required database schema and Telegram readiness are available.

## Files created or modified for this preparation

The working tree already contained earlier module/security changes. This list identifies this preparation's changes rather than attributing every existing Git modification to this task.

Created:

- `compose.resources.yaml`: optional explicit resource allocations.
- `services/api/src/production-config.mjs`: safe production preflight.
- `docs/first-production-deployment.md` and this report.
- `tests/production-config.test.mjs`, `tests/first-deployment-cli.test.mjs`, `tests/first-deployment-database.test.mjs`.

Modified:

- `.env.example`, `.gitignore`, `.dockerignore`: central blank-secret template and secret/session/build-context exclusions.
- `compose.yaml`: required Telegram fields, explicit session/checkpoint paths, production runtime mapping and API process health. `compose.coolify.yaml` replaces the earlier overlay with a complete four-service Coolify resource without host ports.
- `services/stream-go/internal/config/config.go`, `config_test.go`; `cmd/stream-service/main.go`, `cmd/stream-discover/main.go`: runtime validation, account binding, no source fallback, configuration-check entrypoint, environment-aware CLI session/source.
- `services/api/src/config.mjs`, `server.mjs`, `settings.mjs`; `services/api/prisma.config.ts`: production checks/bind settings, Telegram-only username meaning, credential-free Prisma generation and controlled initialization documentation.
- `scripts/start-production.mjs`, `scripts/db-migrate.mjs`, `scripts/test-database.mjs`: independent startup/migrations, bounded redacted migration diagnostics and database regression coverage.
- `infrastructure/docker/Caddyfile`, `Caddyfile.coolify`; `tests/admin-routing.test.mjs`: integrated public readiness route and real proxy verification.
- `README.md`, `services/stream-go/README.md`, `docs/automatic-streaming.md`, `docs/module42.md`, `docs/module5.md`, `docs/module5-resources-update.md`, `docs/admin-access-security.md`: current deployment guidance and historical-report clarifications.

Existing Dockerfiles were inspected and retained for this task; their earlier working-tree changes were not reverted. Existing database schema/migrations were not changed by this preparation. No application data migration was executed against the selected application schema. The existing `.env` and six migration-file hashes match the preparation baseline. Local generated test artifacts remain ignored under `.local/qa`.

## Verification results

| Check | Result and limits |
| --- | --- |
| Public/admin production builds | **Passed** with `npm.cmd run build`; both Vite production outputs generated |
| Node regression suite | **Passed**, `node --test --test-concurrency=1 tests/*.test.mjs`: 125 checks, 113 passed, 12 skipped, 0 failed |
| Production environment unit tests | **Passed**; safe errors, required fields, HTTPS/TLS, production Clerk keys, signing keys and configuration boundaries |
| Native Go suite | **Passed**, `node scripts/go.mjs test`; both command packages compiled and all package tests passed on Windows |
| Actual API/Go preflight CLIs | **Passed**, `RUN_DEPLOYMENT_TESTS=1 node --test tests/first-deployment-cli.test.mjs`; real Go service compiled and each missing Telegram variable rejected; Node check validated without migrations/network |
| Prisma generation without credentials | **Passed**, locked Prisma 7.10.1 client generation with database URLs absent |
| Controlled migration + production API | **Passed**, `RUN_DB_TESTS=1 node --test tests/first-deployment-database.test.mjs`; real migrate job and production entrypoint, local source stub, disposable isolated PostgreSQL schema |
| Initialization safety | **Passed** in that database test: `/livez` succeeds before setup, readiness fails before schema exists, startup creates no tables, missing first-OWNER config fails explicitly, two controlled runs are idempotent and preserve administrator identity |
| Real proxy/browser checks | **Passed**, `RUN_CADDY_TESTS=1 RUN_BROWSER_TESTS=1 node --test tests/admin-routing.test.mjs`: 3 checks; actual local Caddy, dev/preview routes and headless Chrome. Includes `/readyz`, legacy admin 404, indexing controls, anonymous console/login and credential-log redaction; no real production Google login |
| Compose validation | **Passed**, standalone and complete Coolify models; four services, external DB, no backend public ports, no default quotas; optional resource overlay validated with explicit fixture allocations |
| Secret/development configuration scan | **Passed**, 10 built frontend files and 205 source files; configured secrets absent from frontend output, no development API origins in builds, no Telegram test source in production runtime files |
| Original secrets/migrations | **Passed**, seven protected files unchanged against baseline (`.env` plus six migrations) |
| Docker image builds | **Blocked/failed attempt**: local Docker daemon unavailable. Verified local named-pipe context; no remote daemon/VPS contacted |
| Linux static Go cross-build | **Failed** from insufficient local disk space while writing a compiler archive; Linux binaries/images remain unverified |

The unrestricted parallel Node run also failed (8 crashed test files) with local out-of-memory/thread-allocation errors. Its sequential rerun above passed without application changes. An earlier strengthened initialization test failed during the period of local disk exhaustion; after recovering space, the full strengthened test passed in 118 seconds. The logs do not establish a definitive cause for that earlier initialization failure. Only this repository's generated Go build cache was cleared, with its absolute path and containment checked; source, secrets and database records were not deleted.

The default suite's 12 skips are opt-in integration checks: Caddy, administrator database security, actual preflight CLI, first-deployment database, Module 4.1/4.2/4.3 databases, backup round-trip, Module 5 capacity/lifecycle/operations, and FFmpeg fixtures. Caddy, preflight CLI and the new first-deployment database checks were separately enabled and passed as recorded above. The remaining opt-in suites were not rerun for this preparation. A previous backup test remains blocked by a local PostgreSQL client/server major-version mismatch. No load test was performed.

Local evidence: `.local/qa/first-deployment-node-sequential.tap`, `first-deployment-bootstrap-rerun.tap`, `first-deployment-compose-check.json`, `first-deployment-secret-preservation.json`. These ignored artifacts are not a production monitoring record.

## Manual Coolify handoff

1. Review the release; complete image builds on an available local/CI Docker engine and resolve the blockers below.
2. Create a Hub project/resource from the reviewed Git repository using Docker Compose, Base Directory `/`, Compose Location `/compose.coolify.yaml`. Do not merge the standalone file or enable automatic deployment/hooks for initialization.
3. Enter this resource's runtime variables from `.env.example`, including the four real Telegram values, existing database, independent secrets, production Clerk keys and authorized hostname. Keep secrets out of build arguments. Set `PLAYBACK_DRAIN=1` during verification.
4. Provision the reviewed read-only signing files with the documented container-user permissions and preserve the two Hub-only named volumes. Route only proxy internal port 80 through Coolify's existing TLS ingress.
5. Deploy only Hub after review. In one API container, inspect migration status and run the controlled migration command. Provision the intended Telegram session with the documented single-writer procedure.
6. Require integrated HTTPS `/readyz` success; verify approved/unapproved administrator access, Free/VIP playback, seeking, per-account VIP sessions and separate analytics. Remove drain and share the address only after acceptance.

Exact commands, session provisioning, backup/recovery, troubleshooting, redeploy/rollback and later hostname changes are in the deployment guide. None of these VPS steps were performed by the agent.

## Remaining release prerequisites

- **HTTPS hostname:** the user confirmed no Coolify URL exists yet. Default `sslip.io` URLs are HTTP-only per current Coolify documentation; use an authorized hostname supporting trusted TLS and necessary DNS control. No domain purchase was made or required by this task. Secure cookies/origin checks remain enforced. [Coolify domains](https://coolify.io/docs/core/networking/domains).
- **Clerk/OWNER transition:** current approved OWNER is associated with a development identity and has no MFA enrolled. Production keys, Google origin/DNS configuration, MFA/recovery and a separately authorized verified association of the existing OWNER to any production Clerk identity are unresolved. No automatic email relinking/backdoor was added. Clerk instances have separate identities. [Clerk environments](https://clerk.com/docs/guides/development/managing-environments).
- **Database preservation:** arrange least-privilege runtime credentials/provider network access and a server-major-compatible tested backup/restore. The selected role's previously observed database/role creation privileges were not altered. Disposable-schema migration tests do not replace backups.
- **Platform verification:** local Docker daemon/build availability and sufficient build disk space; real Ubuntu images, session mount permissions, shared ingress/TLS, provider connectivity, actual Telegram account/source, real production Google login and customer-device playback still require verification.

No existing deployment or unlimited physical streaming capacity is claimed. No VPS containers, other projects, shared ingress, production secrets or application data were modified.
