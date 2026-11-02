> Current Module 4.2 updates administrator authorization to approved database emails and adds visibility, moderation and platform settings. See [the current implementation](module42.md). Earlier foundation notes below retain their historical context.

# Automatic discovery, streaming and operations

The runtime now uses `cmd/stream-service` and the real Node API. The original interactive discovery CLI and single-message development server remain available for diagnosis. The live frontend no longer reads `.local/catalogue.json`.

Video cards also request [automatic cover thumbnails](video-previews.md) from
the actual Range streams. The API image includes FFmpeg; previews use a bounded
memory image cache, with no video files or chunks written to VPS disk.

## Data flow

1. Go reuses the authorized Telegram session, resolves exactly one accessible source named by `TELEGRAM_SOURCE`, and scans its history in pages of 50 until the accessible end.
2. Video detection reuses Module 1: Telegram video attributes, video MIME types and recognized video-document extensions. Non-video documents are skipped. Filename, original caption, actual byte size, MIME, timestamp and measured duration when present are stored; missing fields are not fabricated.
3. Catalogue keys include peer kind, source ID and message ID. Upserts cannot duplicate a message. Source identity is pinned in persisted state; selecting another source requires a separate state file.
4. A page's upserts and continuation offset are committed together in an atomic metadata snapshot. The temporary file is fsynced before rename; the directory is fsynced when the filesystem supports it. Restart resumes the committed offset. Failed mutation/commit leaves the preceding snapshot intact.
5. gotd's update manager delivers live new/edited messages. Those upsert the selected source immediately. Channel deletion updates remove corresponding records. Recovery polling scans only new history down to the previous high-water mark, every 30 seconds by default.
6. One rolling archive page per cycle reconciles older metadata, edits and deletions missed while offline. It does not repeat a complete archive scan on every poll. Its independent audit offset is persisted. Missing records are removed only within the audited ID window, including the oldest records when history ends. Records added or changed by live updates during the history request are preserved for a later audit.
7. Node serves the synchronized catalogue and proxies only known opaque IDs to Go. React refreshes its catalogue every 15 seconds and when the window regains focus. Search and existing sorts use that refreshed data. No rebuild is needed for a new video.

Module 4.1 adds Prisma/PostgreSQL as the durable application store for catalogue metadata, accounts, qualified views, subscriptions and audit history. Node imports the existing Go catalogue every 15 seconds. The Go atomic snapshot remains its discovery checkpoint, not a video cache. Never run two Go writers against the same session/checkpoint volumes. Back up PostgreSQL and the private Go state independently; do not delete checkpoints to recover a transient outage. See [Module 4.1](module41.md) for migrations and account/admin configuration.

## Local commands

Run from the repository root with the existing `.env` and authenticated session:

```powershell
npm.cmd ci
npm.cmd run runtime:build
npm.cmd run runtime:go
```

In separate local test terminals:

```powershell
npm.cmd run runtime:api
npm.cmd run dev
```

Local wrappers generate independent random service tokens once in ignored `.local/runtime.json`, without printing them. They use loopback addresses and preserve the root `.env`. Only the Go process reads the Telegram credentials/session. Stop the old `stream-discover -mode serve` before using the new service with that session. Local terminals are for development; production uses the managed Compose services below.

`node scripts/verify-runtime.mjs` checks a small portion of an automatically discovered video via the frontend origin and compares it to the Go service response. It saves only a JSON result in `.local/runtime-verification.json`, never a video file.

## API and service boundaries

Public same-origin routes remain `GET /api/videos`, `GET /api/videos/:id`, and `GET|HEAD /api/videos/:id/stream`. Catalogue responses now include `{items, total, nextCursor, sync, source:"postgresql", capabilities}`. Latest can fall back to `source:"telegram-sync"` during database outages. `sync` reports initial completion, latest successful recovery scan, sanitized error and revision. A partial initial catalogue is not reported as a completed scan.

Private Go routes are `/internal/catalogue`, `/internal/videos/:id/stream` and `/readyz`, protected by `Authorization: Bearer STREAM_SERVICE_TOKEN`. The Node API requires `X-Gateway-Token: API_GATEWAY_TOKEN`; the public proxy replaces that header at the trusted routing boundary. No tokens, internal addresses, file references or access hashes are placed in frontend configuration.

Go `/healthz` and Node `/livez` are liveness probes. Go `/readyz` checks connection and synchronization freshness; Node `/healthz` queries it and PostgreSQL application tables, returning 503 when either is unavailable. Container liveness is deliberately separate from a temporarily unavailable Telegram connection, so a routine external outage does not create a restart storm. Monitor API readiness as well as container health. Health checks alone do not send operator alerts; connect a VPS monitoring system before operational launch.

The original aligned, incremental HTTP Range implementation is reused, with bounded parts, per-part deadlines, cancellation and finite retries. `STREAM_CONCURRENCY` defaults to four active requests (configurable from 1 to 8), allowing a player to overlap its current read, metadata/tail read and seek. The authenticated gateway's `TrustedInternal` option bypasses development-only Host checks only after bearer authentication. The legacy public development handler retains its loopback/Host/Origin restrictions.

Native playback needs a supported container and codec. MP4 does not guarantee its codec will decode; MKV/HEVC browser compatibility remains limited. No transcoder/remuxer is implemented. Device caching can be disabled without changing native playback: the service worker then passes the native request directly to the network instead of imposing its segment loader. Enabled caching still uses bounded verified browser-side segments.

Qualified view events now persist in PostgreSQL. Most Viewed and Trending use actual viewing activity; Longest uses real measured duration. Range/thumbnail reads never add views. Shared comments remain unavailable. No fake activity substitutes for missing data.

## Hostinger VPS / Coolify preparation

`compose.yaml` builds production frontend assets, a Node runtime and the Go daemon, with Caddy providing HTTPS and routing. Only proxy ports 80 and 443 are published. Backend ports stay on the Compose network. The Go container can reach Telegram outbound.

Required secrets/values: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, two independent service tokens (32+ random characters), `PUBLIC_HOST` (hostname only), and the existing `DATA_BASE_URL` PostgreSQL connection. Membership currency defaults to ETB. Human support contact and Clerk keys/administrator allowlist remain configuration items; live Clerk setup is deferred to Module 4.2. Never add a `VITE_` prefix to secrets. Use `.env.example` as a list of names, not as valid credentials, and do not overwrite the existing `.env`.

Public browsing is anonymous; the temporary whole-site Basic Auth gate was removed. Normal account operations use secure application sessions. The separate `/admin/` build requires backend-verified Clerk authorization and an explicit administrator allowlist; missing configuration denies access. The proxy preserves the Clerk Authorization header. Use HTTPS for production cookies and traffic.

On a configured Linux VPS:

```sh
sudo systemctl enable --now docker
docker compose config --quiet
docker compose build
# One-time interactive login into the persistent named session volume:
docker compose run --rm --no-deps --entrypoint /usr/local/bin/stream-discover stream-go -mode find -session /sessions/telegram.session.json
docker compose up -d
docker compose ps
docker compose logs --tail 100 stream-go api
```

Enter Telegram phone/code/password only in that terminal. The headless daemon never prompts or invents successful authentication. Named volumes `telegram_session` and `catalogue_state` survive container replacement. Caddy state volumes preserve certificates. `restart: unless-stopped`, enabled Docker startup, graceful shutdown and log rotation are configured. Intentionally stopped containers remain stopped; restart them explicitly. Changing application settings requires recreating the affected service.

For Coolify, import the Compose project, configure the same environment/secrets and persistent volumes, point domain/DNS at the proxy, and let one TLS proxy own the public ports. If Coolify terminates TLS itself, adapt the supplied Caddy boundary deliberately rather than publishing Go/Node ports or stacking conflicting TLS listeners. Verify Host/Origin settings and the private gateway/admin authorization boundary in that arrangement.

The current PostgreSQL database is external and uses `DATA_BASE_URL`; no duplicate container is created. The API runs additive Prisma migrations and idempotent package seeding before serving traffic. A migration failure prevents startup. Configure provider backups/restore checks and a suitably sized connection pool. A later self-hosted database needs a persistent volume and independent health/backup management.

## Deployment acceptance checklist

After building on the actual VPS, verify TLS, anonymous browsing and denied unauthorized administrator access, then monitor `/healthz` on the API's private endpoint. Test a playback range through the authenticated public origin. Kill the Go container process in a maintenance test and confirm its restart count rises and readiness recovers. Reboot the VPS and verify Docker and all intended services return without terminals. Confirm session reuse without login and unchanged catalogue IDs/counts after restart. Test network interruption/recovery, large-file seeking, peak concurrency and backup restoration. A Compose restart policy is configuration evidence, not evidence that these VPS checks passed.

If the VPS, Telegram network or required service is down, streaming is unavailable. The API returns a clear 503 and the frontend can retry after recovery. No availability guarantee is made for complete infrastructure outages.
