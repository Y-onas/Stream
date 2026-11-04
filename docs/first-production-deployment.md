# First production deployment — Habeshan HUB on Hostinger and Coolify

This application has **never been deployed to production**. Earlier reports describe local development and tests, not an existing VPS installation. These instructions prepare a first release alongside the VPS's other projects. No command in this guide was executed on the VPS by the agent.

## 1. Decisions and release blockers

- Keep the existing **external PostgreSQL database** supplied through `DATA_BASE_URL`. No new PostgreSQL container or empty database is selected. Existing accounts, administrator approvals, memberships, videos, progress and analytics must be retained.
- Use **`compose.coolify.yaml` alone**. It is now a complete four-service definition, not the former overlay. Do not merge it with `compose.yaml`: the latter is the standalone-host definition and publishes ports 80/443. Coolify must retain ownership of the shared ingress.
- Only `proxy` receives a public domain, targeting its **internal port 80**. Go, API and database receive no public port mapping.
- CPU/RAM quotas and media bitrate throttling remain disabled by default as requested. `compose.resources.yaml` is an optional, explicit resource-budget overlay; it does not introduce viewer limits. Do not enable it or change allocations automatically.
- No source videos/chunks are cached on VPS disk. Persistent storage below is Telegram authorization and catalogue metadata only.

### HTTPS is not yet available

No Coolify URL has been created yet. Coolify's current documentation says its default IP-based **`sslip.io` URLs are HTTP-only** and are not a production TLS solution. Do not change one to `https://` and assume a certificate will issue, and do not disable Secure cookies to compensate. An authorized HTTPS-capable hostname (with the DNS control needed for Clerk production setup) is required before real login, membership or playback. A generated hostname under an already configured owned wildcard, or another authorized hostname supporting trusted TLS, can avoid buying a new domain. Obtaining/configuring it remains a manual prerequisite. [Coolify domains](https://coolify.io/docs/core/networking/domains).

An HTTP-only generated URL may be used to inspect a non-sensitive routing preview, not to collect credentials/payments or launch this application to customers. The production API preflight requires HTTPS origins.

### Other outstanding release items

1. Local Docker image builds were attempted but the **local Docker daemon was unavailable**. A separate Linux cross-build ran out of local disk space. Images and Linux/container execution still need verification before release; native Windows Go builds/tests passed.
2. The existing OWNER is linked to a Clerk **development** identity and currently has no MFA enrolled. Review the existing Clerk production environment, Google configuration, MFA and recovery before launch. The production preflight rejects development keys. Clerk development/production instances have separate users; changing keys can change the Clerk user ID. Preserve the existing PostgreSQL OWNER row/role and perform a separately authorized, verified identity-association migration if needed. Do not add automatic email-based relinking or create a second OWNER to bypass this check. [Clerk environments](https://clerk.com/docs/guides/development/managing-environments), [Clerk production setup](https://clerk.com/docs/guides/development/deployment/production).
3. The previously inspected database role can create databases/roles. Arrange least-privilege runtime access and provider network restrictions; no live permissions were changed by this task.
4. A server-major-compatible, tested database backup/restore is required. The previous local backup test was blocked by a client/server version mismatch; migration tests are not backup verification.

## 2. Prerequisites — check, do not replace existing host services

The operator needs access to the existing Coolify dashboard, the intended Hostinger Ubuntu server/destination, the reviewed Git release, Telegram's intended account and source, the existing database, the existing Clerk application and private key/session backups.

Verify that the existing Docker/Compose installation supports normal Compose service health checks and volumes. Do not reinstall/restart Docker, change the server firewall/shared ingress, claim host ports 80/443, or edit another project's networks. Do not run blanket commands such as `docker system prune`, `docker compose down -v` or recursive ownership changes against Coolify directories.

Builds can consume shared CPU/RAM too. Schedule the first build through the operator, or verify/build release images on an available local/CI Docker engine first. This guide does not claim a measured safe viewer capacity.

## 3. Services and production commands

| Service | Source and Dockerfile | Build | Start | Internal port / health | Storage / shutdown |
| --- | --- | --- | --- | --- | --- |
| Public React + admin React (`web`) | `apps/web`, `apps/admin`; `infrastructure/docker/web.Dockerfile` | `npm ci`; `ADMIN_BASE=/hub-console/ npm run build` | Caddy image default command, serving `static.Caddyfile` | 80; `GET /healthz` | No application data; restart unless stopped |
| Node API (`api`) | `services/api`; `infrastructure/docker/api.Dockerfile` | `npm ci`; locked Prisma Client generation; prune dev dependencies | `node scripts/start-production.mjs` | 3000, bound to `0.0.0.0`; `/livez` is liveness; `/healthz` is DB/Telegram readiness | Signing files mounted read-only; 20-second stop grace, Node drains/cancels work |
| Telegram + streaming (`stream-go`) | `services/stream-go`; `infrastructure/docker/stream.Dockerfile` | Linux Go builds of `cmd/stream-service` and existing `cmd/stream-discover` | `/usr/local/bin/stream-service` | 8080, bound to `0.0.0.0`; `stream-service healthcheck` probes loopback `/healthz` | `/sessions`, `/state`; UID/GID 10001; 20-second grace, cancellation and orderly shutdown |
| Hub HTTP gateway (`proxy`) | `infrastructure/docker/Caddyfile.coolify`; Caddy image | No application build | Image default Caddy command | 80; loopback `/healthz` with `Host: $PUBLIC_HOST`, checking its web route | Hub-only proxy; existing Coolify ingress terminates TLS; rotated logs |

The API Docker build generates Prisma Client without a database URL or network connection to PostgreSQL. Neither frontend requires build-time environment files. Browser requests use same-origin `/api/...`; Clerk's publishable key is fetched from the API. No server secret is a frontend build argument.

The two frontend applications are intentionally served by one static container. Do not add another frontend API or Telegram service. All Hub services share a project-scoped `runtime` Docker network. This bridge allows required outbound Telegram, Clerk and database connections; private backend ports have no host publication. Coolify attaches its existing ingress to the receiving resource network; do not manually replace that ingress. [Coolify Compose](https://coolify.io/docs/applications/builds/docker-compose).

## 4. Environment template and all runtime variables

Use the root **`.env.example` as a name/reference template**, never as deployable values. Do not overwrite the existing local `.env`. In Coolify, enter values in this application's Environment Variables. Set secrets to **runtime only**, not build-time; use the literal setting where values contain `$`. Developer view synchronizes/removes entries, so review it before saving. [Coolify environment settings](https://coolify.io/docs/applications/configuration/environment-variables).

There are no duplicated API/Go/frontend environment templates: the complete Compose file maps the central variables to their owning services. Paths used for host mounts and container paths are deliberately distinguished below. Every application variable here is runtime unless explicitly labelled otherwise. Never add `VITE_` to a secret.

### Telegram and private service communication

| Exact name | Service | Required | Secret | Meaning / safe value |
| --- | --- | --- | --- | --- |
| `TELEGRAM_API_ID` | Go | Yes | Server-only identifier | Your positive 32-bit Telegram app ID; template is blank |
| `TELEGRAM_API_HASH` | Go | Yes | Yes | Your 32-hex-character Telegram API hash; blank template |
| `TELEGRAM_SOURCE` | Go | Yes | Server-side source metadata | Exact accessible group/channel **display title**, matching the current discovery implementation; not an invite URL or numeric ID; blank template |
| `USER_NAME` | Go | Yes | Server-side account identity | Intended account's primary Telegram username; 5–32 ASCII letters/digits/underscores, first a letter; optional `@`; must match the saved account; blank template |
| `TELEGRAM_SESSION_PATH` | Go/interactive CLI | Default supplied | File holds a secret | `/sessions/telegram.session.json`; configurable filename within the mounted directory |
| `CATALOGUE_PATH` | Go | Default supplied | Private metadata | `/state/catalogue.json`; checkpoint, not video cache |
| `STREAM_SERVICE_TOKEN` | API + Go | Yes | Yes | Independent random secret of at least 32 characters; blank template |
| `API_GATEWAY_TOKEN` | Hub proxy + API | Yes | Yes | A different random secret of at least 32 characters; blank template |
| `STREAM_LISTEN` | Go | Compose supplies | No | `0.0.0.0:8080`; do not publish this port |
| `STREAM_ORIGIN` | API | Compose supplies | No | `http://stream-go:8080`, private Docker communication |
| `STREAM_HEALTH_URL` | Go health utility | Optional | No | Default `http://127.0.0.1:8080/healthz`, loopback only |
| `SYNC_INTERVAL` | Go | Optional | No | `30s`; at least five seconds |

There is no built-in test source fallback. Changing any of the four Telegram values requires configuration/restart only, not source edits. A new account needs its own authorized session; a changed source needs a separate/backed-up source-bound catalogue checkpoint. Do not silently erase the old state. `USER_NAME` no longer names the first administrator: existing administrator names are stored in PostgreSQL and are preserved.

### Database, Clerk and platform

| Exact name | Service | Required | Secret | Meaning / safe value |
| --- | --- | --- | --- | --- |
| `DATA_BASE_URL` | API | Yes | Yes | Existing external PostgreSQL URL, including database/schema and provider TLS options; blank template |
| `DATA_BASE_DIRECT_URL` | API container's controlled migration process | Optional | Yes | Direct/migration-role URL to the **same** database/schema; current Compose passes it to API for that manual job; otherwise the helper converts a Neon pooled host for migrations |
| `DATABASE_POOL_MAX` | API | Optional | No | `4` in Compose; accepted 1–32 |
| `CLERK_PUBLIC_KEY` | API, returned publicly to admin UI | Yes, or existing alias | No | Production `pk_live_` publishable key from the existing application; blank template |
| `CLERK_PUBLISHABLE_KEY` | API | Optional existing alias | No | Used only when `CLERK_PUBLIC_KEY` is absent |
| `CLERK_SECRET_KEY` | API | Yes | Yes | Production `sk_live_` server key from the existing application; identity/session checks still require it even with a JWT key |
| `CLERK_JWT_KEY` | API | Optional | No, public PEM | Networkless session-signature verification key; identity/session lookups remain server-side |
| `EMAIL` | Controlled migration/bootstrap | Conditional | Administrator identity | Required only to approve the first OWNER in an administrator-empty database; existing bootstrap marker/owners win; blank template |
| `MEMBERSHIP_CURRENCY` | API/migration seed | Optional | No | `ETB`, preserving the selected product currency |
| `APP_TIMEZONE` | API/default settings | Optional | No | `Africa/Nairobi`; stored platform settings remain authoritative |
| `TELEGRAM_SUPPORT_USERNAME` | API/default settings | Optional | No | Actual human support username, separate from `USER_NAME`; leave blank if unset |
| `FFMPEG_PATH` | API/native development | Optional | No | Default `ffmpeg` on PATH; API image installs it; no frontend video transcoding is added |

Do not rename `DATA_BASE_URL` or Clerk variables. Do not use a second empty database as a quick fix. Do not make PostgreSQL public to solve a connection problem. Use the selected provider's supported TLS settings; do not disable certificate verification. The old unused `DATABASE_SSL_MODE` name does not configure the driver; connection URL/provider settings do.

### Hostname, process and playback keys

| Exact name | Service | Required | Secret | Meaning / safe value |
| --- | --- | --- | --- | --- |
| `PUBLIC_HOST` | Compose/Hub proxy | Yes | No | Chosen hostname only, without scheme/path/port; blank until created |
| `PUBLIC_ORIGIN` | API | Compose derives | No | `https://` + `PUBLIC_HOST`, no trailing slash |
| `ADMIN_ORIGIN` | API | Compose derives | No | Same HTTPS origin; `/hub-console` is a path, not part of this value |
| `NODE_ENV` | API | Compose supplies | No | `production` |
| `API_HOST`, `API_PORT` | API | Compose supplies | No | `0.0.0.0`, `3000` |
| `PLAYBACK_PRIVATE_KEY_PATH` | Host mount/API | Yes | Path; contents secret | Absolute host file path; API sees `/run/secrets/playback-private.pem` |
| `PLAYBACK_PUBLIC_KEY_PATH` | Host mount/API + Go | Yes | No, public PEM | Absolute matching host file; containers see `/run/secrets/playback-public.pem` |
| `PLAYBACK_PREVIOUS_KEYS_PATH` | Host mount/API + Go | Optional | No, public keys only | Host JSON key ring; empty selects `infrastructure/docker/playback-previous.empty.json` |
| `PLAYBACK_KEY_ID` | API + Go | Optional | No | Empty derives matching `kid` from public key |
| `PLAYBACK_GRANT_TTL_SECONDS` | API | Optional | No | `300`, allowed 30–600 seconds |
| `PLAYBACK_ISSUER`, `PLAYBACK_AUDIENCE` | API + Go | Optional | No | `habeshan-hub`, `habeshan-stream`; both sides must match |
| `PLAYBACK_CHECK_URL` | Go | Compose supplies | No | `http://api:3000/internal/playback/check`, private only |
| `PLAYBACK_CHECK_INTERVAL` | Go | Optional | No | `15s`, accepted one–15 seconds |
| `PLAYBACK_CLOCK_TOLERANCE_SECONDS` | API | Optional | No | `30`, accepted zero–30; does not extend expired grants |
| `PLAYBACK_CLOCK_TOLERANCE` | Go | Optional | No | `30s`, matching bounded policy |
| `PLAYBACK_SESSION_UPSTREAM_LIMIT` | API | Optional | No | `1` or `2` parallel requests per playback; stored policy can override; not a global viewer cap |
| `PLAYBACK_DRAIN` | API | Optional | No | `0`; `1` manually pauses new playback while preserving recovery |
| `ADMIN_BASE` | Admin build | Build-time, fixed by Dockerfile | No | `/hub-console/`; do not change for a hostname change |

`PLAYBACK_GLOBAL_LIMIT`, `TELEGRAM_UPSTREAM_LIMIT`, `STREAM_CONCURRENCY` and `STREAM_MAX_BYTES_PER_SECOND` are retired production controls. No arbitrary global viewer reservation or production bitrate cap is restored. Node/Go runtime memory defaults still exist; no fixed app memory target is supplied.

Optional resource overlay only: `HUB_API_CPUS`, `HUB_API_MEMORY`, `HUB_GO_CPUS`, `HUB_GO_MEMORY`, `HUB_WEB_CPUS`, `HUB_WEB_MEMORY`, `HUB_PROXY_CPUS`, `HUB_PROXY_MEMORY`. These are non-secret runtime Compose limits and are all required **only when that overlay is explicitly enabled**. Each prefix names its owning service (`GO` = `stream-go`); these are runtime Compose inputs. CPU values are Docker core quotas and memory values are Docker byte/unit strings. Set operator-approved positive Docker CPU/memory values; the template deliberately invents no production budget. `POSTGRES_BIN` is a local backup-test tool directory, not an app container variable. Development/QA wrappers have their own loopback settings and are not production entrypoints.

## 5. Create the Coolify resource without deploying

1. Open the existing project/environment, or create a new **Habeshan HUB** project without changing other projects. Select the existing Ubuntu server/destination.
2. Add the reviewed Git repository through the existing supported source connection. Choose the branch/commit containing this preparation; do not assume an uncommitted local file has reached Coolify.
3. Select **Docker Compose** as the build strategy. Base Directory: `/`. Docker Compose Location: **`/compose.coolify.yaml`**. Save and reload the definition.
4. Confirm exactly `web`, `api`, `stream-go`, `proxy`. Do not use the standalone `compose.yaml`, a Node-only build pack, or a second database resource.
5. Leave automatic deployment off during first-release preparation. Leave custom build/start hooks blank unless an operator has reviewed a concrete need. In particular, do not put migrations into every API start command.
6. Open Domains/Add domain. Assign only `proxy`, internal port **80**, path empty. Choose the actual HTTPS-capable hostname; if the only generated URL is HTTP `sslip.io`, stop before customer login/production launch as explained above. Never assign the same complete hostname as another project/dashboard.
7. Set `PUBLIC_HOST` to that hostname. Enter the required central runtime environment values, mark secrets runtime-only, and provision files/volumes below. No frontend rebuild is needed merely to select the hostname.

Coolify UI labels vary by release; the receiving service/port and single Compose location are the values that matter. Do not edit shared ingress configuration. [Compose resource settings](https://coolify.io/docs/applications/builds/docker-compose), [domain service/port selection](https://coolify.io/docs/core/networking/domains).

## 6. Signing keys and persistent storage

Use the existing matching key pair if appropriate; do not rotate it accidentally. The existing `node scripts/playback-keys.mjs` creates a pair only when absent and refuses a mismatch. Do not put keys in Git or Docker images. Securely provision the host files selected by the two `PLAYBACK_*_KEY_PATH` settings before creating containers.

On the server, the private file must be readable by API UID **1000**, mode **0600**; the public file must be readable by UID **10001** too, normally **0644**. Change ownership only on the intended Hub files, never recursively on Coolify/shared directories. Parent host directories should remain private. Both mounts are read-only inside containers. The optional previous-key JSON contains public keys only.

| Compose volume key | Container mount | Writer | Purpose |
| --- | --- | --- | --- |
| `telegram_session` | `/sessions` | Go UID/GID 10001, one process at a time | gotd authorization session, directory 0700/file 0600 |
| `catalogue_state` | `/state` | Go UID/GID 10001 | Source-bound discovery checkpoint/metadata |
| `caddy_data`, `caddy_config` | `/data`, `/config` of Hub proxy | Hub Caddy only | Proxy metadata, not source video cache |

Coolify may prefix actual Docker volume names with its Compose project/resource ID. Record the names shown for **this** resource; do not invent a globally shared volume name. Keep the same resource/project across redeployments. A new resource/project can create different empty volumes and requires an explicit backup/restore plan.

The Go image creates `/sessions` and `/state` owned by 10001. New named volumes inherit that image-directory ownership. Restoring as root must preserve/reapply the file owner so Go can enforce permissions. A container replacement preserves named volumes; deleting the volume does not. Never scale two Go writers against the same session/checkpoint volume.

## 7. Authenticate the intended Telegram account using the existing flow

This is a human operator step; the agent did not contact Telegram or collect login codes during preparation.

1. In a private local file such as `.env.production.local`, set the **four exact Telegram variables** to the intended real values. Do not copy a template over an existing `.env`. The account must have a primary username and source/history access.
2. Build the existing discovery CLI locally. Use a fresh dedicated session file if the local daemon already uses another file:

```powershell
npm.cmd run go:build
.\bin\stream-discover.exe -env .env.production.local -session .sessions/production/telegram.session.json -check-config
.\bin\stream-discover.exe -env .env.production.local -session .sessions/production/telegram.session.json -mode find
```

3. Enter phone/code/two-step password only into its hidden interactive terminal prompts. Never put them in flags, environment templates, chat or logs. The CLI confirms that `USER_NAME` matches the authorized account and that the source is accessible.
4. Securely transfer the resulting session to a private Hub-only server staging location. Do not bake it into an image or publish it through the web container.
5. After the first Hub containers exist, stop **only this Hub Go container** before installing the session. Use its actual name from Coolify. The following are operator commands, not commands executed by the agent. Fill in only this resource's names/paths:

```bash
# Actual Hub container and private staging file, selected by the operator.
HUB_GO_CONTAINER='<this-Hub-stream-go-container>'
HUB_SESSION_FILE='<absolute-private-Hub-session-staging-file>'
docker stop "$HUB_GO_CONTAINER"
sudo chown 10001:10001 "$HUB_SESSION_FILE"
sudo chmod 600 "$HUB_SESSION_FILE"
docker cp --archive "$HUB_SESSION_FILE" "$HUB_GO_CONTAINER:/sessions/telegram.session.json"
docker start "$HUB_GO_CONTAINER"
```

The destination above assumes the template's default `TELEGRAM_SESSION_PATH`. If its filename was changed, copy to that configured path within `/sessions`. Check Coolify's mount mapping before copying: the destination must be this resource's persistent volume. The existing interactive CLI can alternatively run as a one-off container from the same Go image with the same volume, **only while its daemon is stopped**. Do not create a different authentication implementation or run two session writers.

Changing the Telegram account requires its matching session. Changing source must not overwrite a source-bound catalogue backup; use a separately provisioned checkpoint volume when appropriate. A username or source mismatch fails rather than silently streaming the test group.

## 8. Database backup, migration and first OWNER

Before any migration, verify the existing target database/schema and take a provider snapshot or a **server-major-compatible** `pg_dump --format=custom --no-owner --no-acl` backup. Supply credentials through protected environment variables/`.pgpass`, never a password in a command argument or screenshot. Keep archives outside public roots/Git, encrypted under the operator's backup policy. Test `pg_restore` into a separate disposable database before relying on that backup; never use `--clean` against the application to test recovery.

The API does **not** migrate or seed on startup. After images/keys/env are ready, the operator runs one controlled command in **one API container** (Coolify Terminal) before enabling customer traffic:

```bash
# Read-only status first, using the project's locked Prisma 7.10.1 CLI/config.
node node_modules/prisma/build/index.js migrate status --config services/api/prisma.config.ts
# Explicit, reviewed migration + idempotent plans/one-time-owner bootstrap:
node scripts/db-migrate.mjs
```

Run only once per reviewed release when migrations are needed, not from every replica. `prisma migrate deploy` is the installed locked CLI operation; do not run `db push`, `migrate reset`, `migrate dev` or download a different latest CLI on the server. Existing migration files/checksums remain unchanged.

`DATA_BASE_DIRECT_URL`, if set, must address the same database/schema. Prefer separate operator/migration privileges; do not persist privileged credentials in runtime containers unnecessarily. The current default mapping preserves the optional variable for compatibility, so review it when separating roles. If no direct URL is supplied for Neon, the existing helper selects its direct endpoint while preserving URL options/schema.

The migration command captures bounded, redacted diagnostics in private `.local/migration-output.log` and prints a safe event/code. It seeds package defaults idempotently and approves the first OWNER only when the selected database has no administrators and bootstrap has not already occurred. `EMAIL` supplies that first approval; `USER_NAME` is unrelated. Existing OWNER identities/display names/roles are not reset or renamed. Changing `EMAIL` later is not an access-recovery mechanism.

An administrator-empty database without `EMAIL` reports `owner_bootstrap_required` and exits unsuccessfully instead of reporting initialization complete. Supply the authorized first OWNER email and rerun the controlled command; do not create a public registration path.

If status reports drift, a failed migration or an existing untracked schema, stop and review the database history. Do not delete migration rows or reset the database. The preparation test runs the real migrate command twice in its own disposable schema to check idempotency; it does not migrate the application database.

## 9. First deployment order

Do not proceed until the blockers in section 1 have an operator decision.

1. Review/commit the preparation and confirm local/CI Docker image builds. Verify backups, target database, matching signing files and required real values.
2. Create the Coolify resource and hostname as above; configure runtime secrets/files/persistent volumes without touching other projects. Keep new playback drained (`PLAYBACK_DRAIN=1`) during initial verification.
3. Manually deploy **this Hub resource only**. Its process health can become green before the database/session/source is ready; that is intentional for initialization. No migrations run automatically.
4. Run the controlled API migration command once. Confirm existing administrator/user/video records remain and the correct database was used.
5. Provision the intended Telegram session with one writer, as above. Wait for source connection and initial discovery; a large archive can take time. Do not delete checkpoints or tighten retry intervals to force it.
6. Check integrated readiness, actual approved Google login and an eligible Free/VIP video's bounded playback/seek. Verify the two-VIP-sessions-per-account policy and separate analytics remain; do not load-test the shared VPS.
7. Resolve Clerk production identity binding/MFA and database privilege/network items. Remove the manual drain only after the review. Share the HTTPS URL only after these checks pass.

Do not rely on a first-deployment pre-hook inside an old container: there is no old container. Coolify documents that such hooks can be skipped on the first deployment. The explicit command above is reviewable and does not run independently in every replica. [Coolify deployment commands](https://coolify.io/docs/applications/builds/dockerfile#deployment-commands).

## 10. Readiness, safe logs and acceptance checks

- `/healthz` through the public proxy checks its static web route. It is not database/Telegram readiness.
- **`/readyz` through the Hub proxy** forwards only the API's readiness response: ready/database/Telegram booleans, no credentials or source mappings. Require HTTP 200 and `ready: true` before launch.
- Internally, API `/livez` is process liveness; API `/healthz` is integrated readiness. Go's Docker health is liveness; its authenticated `/readyz` additionally checks connection, initial discovery and checkpoint freshness.
- Use only this Coolify resource's service logs or `docker logs --tail 100 <exact-Hub-container>`. Do not print all container environments or run `docker compose config` into a shared log; use `config --quiet` for validation.
- Safe events include configuration errors naming a field, `api_started`, `database_migration_complete`, Telegram retry classifications and `sync_complete`. Do not paste private migration diagnostics, PEMs, sessions, cookies or authorization headers into chats.
- Hub Caddy omits request URL/headers and response headers from access logs to avoid OAuth tickets, tokens and cookies. Logs remain rotated at 10 MiB × 3 per service.
- Verify `/admin` and `/admin/*` return a plain 404 with no redirect/path hint. The actual console is `/hub-console`, login `/hub-console/login`; admin pages have `noindex` and robots.txt does not advertise their path. Knowing the URL never supplies database approval.
- Perform human OWNER/ADMIN Google login/logout, unapproved-account denial, Free/VIP access, seek/resume and admin termination through the actual HTTPS hostname. Local tests do not prove this real ingress/browser behavior.

## 11. Optional shared-VPS budgets

Do not confuse hardware allocation with viewer admission. Default manifests impose no Hub CPU/RAM quotas, runtime memory targets or media bitrate throttle. They retain bounded buffers, cancellation, PID limits, background workers, DB pools and per-account VIP enforcement.

If the operator later chooses explicit quotas, supply all eight `HUB_*` values and validate:

```bash
docker compose -f compose.coolify.yaml -f compose.resources.yaml config --quiet
```

Apply the same reviewed definition consistently through Coolify rather than silently changing only the start command. No quota is enabled automatically; budgets must account for the other projects. Adding replicas must not blindly multiply an approved shared-host allocation, and the Telegram service must remain a single session/checkpoint writer.

## 12. Redeploy, rollback and recovery

For a code release: back up, review additive migrations/compatibility, build/test the new images, apply any required migration once in a controlled step, then redeploy only Hub. Keep the same volume identities, existing database and matching key mounts. Do not put a reset/seed loop into startup. Check `/readyz` and the protected workflows after replacement.

For rollback, drain new playback and select the previously verified Hub image/release in Coolify, coordinating Node/Go key/grant versions. On a **first** deployment there is no known-good production image yet; preserve the release commit/build artifacts before a later update. Leave additive migrations/records in place. Restoring a backup is a separate reviewed recovery action, not a routine image rollback. Never remove the final valid OWNER.

Restore session/checkpoint backups into the correct stopped Go resource with correct ownership, then start that single writer. Restore PostgreSQL first into a disposable target for verification before any separately approved real recovery. Never delete a volume or database to make a health check green.

## 13. Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing-variable startup error | Supply the exact named runtime variable; no Telegram test fallback exists |
| `USER_NAME` account mismatch | Correct the intended primary username/session pair; do not bypass the binding |
| Session permission failure | Correct UID 10001 and 0700/0600 on this volume/file only; verify no second writer |
| Source not found/ambiguous | Use the exact source display title; verify intended account membership/history access |
| Catalogue belongs to another source | Restore/review source-bound state or provision a separate checkpoint; do not silently discard it |
| Public 502 | Proxy service/internal port 80, Hub network and service health; do not publish API/Go ports |
| `/readyz` 503 but containers healthy | Check DB migration/connection and Telegram authorization/discovery/freshness; liveness is not readiness |
| HTTP generated URL/login failure | Resolve the HTTPS blocker; do not remove Secure cookies or weaken origin checks |
| Admin 403 after changing Clerk keys | Verify production instance/user association; preserve the existing OWNER row and require a reviewed verified rebind |
| Migration error | Read the safe code and private redacted diagnostics; check direct URL/history/permissions; never reset/push |
| Buffering | Check actual source/browser codecs, network/Telegram conditions and available hardware; no application bitrate throttle is configured |

## 14. A purchased/custom domain later

No purchase was made or required by this task. When an authorized domain is available, point its DNS to the existing ingress, add it only to Hub's `proxy` domain configuration at internal port 80, obtain trusted TLS through Coolify, update `PUBLIC_HOST` and the existing Clerk origin/redirect/domain settings, then redeploy Hub. API origins derive from the hostname and callbacks use the browser's origin, so source edits or a new database are unnecessary. Do not keep the old origin authorized accidentally. Users may need to sign in again because cookies/storage are origin-scoped; database memberships/progress remain.

## 15. Local verification record

The [preparation verification report](first-production-verification.md) records exact passed/failed/skipped checks and files changed. Local tests cover runtime validation, both frontend builds, native Go compilation/tests, credential-free Prisma generation, standalone Coolify/optional-resource Compose models, secret boundaries, controlled migrations in a disposable schema and the real production Node entrypoint with a local source stub. The default generated URL, real HTTPS, live VPS container permissions/networking, production Google login and customer devices remain unverified. Docker image builds were blocked by the unavailable local daemon; Linux cross-compilation failed from insufficient local disk space. No load testing, VPS access or deployment occurred.
