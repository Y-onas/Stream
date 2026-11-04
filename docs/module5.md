# Module 5 — Resource protection and playback operations

Implementation date: November 3, 2026. **Current global-capacity policy and verification:** [capacity update](module5-capacity-update.md). Historical test results below describe the earlier implementation where explicitly labelled. This extends Module 4.3; it does not replace authentication, subscriptions, Telegram discovery, original-file streaming or the public design.

## Current resource policy

The owner subsequently requested no fixed Hub CPU/RAM quotas and no artificial video speed throttle. The [resource and speed update](module5-resources-update.md) removes the pilot container allocations, Node/Go memory targets, memory-pressure playback gate and production media pacing. Authorization, per-account VIP enforcement, bounded reads and cancellation remain. The pilot allocation table and deployment-budget instructions below are historical; they are superseded by that request. No production service or shared ingress was changed.

## Historical scope and shared-host decision

The owner explicitly withdrew the request to inspect the VPS and asked that Hub be treated as the fifth-priority project. No SSH/Coolify host inspection, deployment, reboot, host load test or unrelated-project changes were performed.

The owner supplied a usage snapshot: CPU 8%, memory 18%, disk 6 GB of 100 GB, incoming/outgoing traffic 4.8/0.5 MB and bandwidth 0 TB of 8 TB. These are owner-supplied observations, not measurements taken by this agent, and do not establish total CPU/RAM or sustained spare capacity. The owner delegated the choice of a conservative initial Hub budget.

The following **provisional pilot ceilings** are configured for one container of each service. They are not a measured safe production capacity:

| Hub service | CPU ceiling | Hard RAM ceiling | Additional bounds |
| --- | --- | --- | --- |
| API | 0.20 core | 384 MiB | 192 MiB JS heap; bounded DB pool, one password-hashing job; 32 in-flight short API/control requests; open media bodies excluded |
| Go | 0.20 core | 384 MiB | 300 MiB Go GC target; bounded per-request buffers; no global media semaphore |
| Static web/admin | 0.05 core | 64 MiB | Static files only |
| Hub reverse proxy | 0.05 core | 96 MiB | Streaming/backpressure; no source-video cache |
| Total | **0.50 core** | **928 MiB** | CPU shares 128; no swap allowance beyond RAM ceilings |

Docker logging remains rotated at 10 MiB × 3 files per service (approximately 120 MiB maximum across four services). PIDs are capped. These limits constrain Hub containers; they do not guarantee overall host availability when other workloads exhaust shared resources. No automatic resource or replica increase is implemented. Adding replicas requires dividing the same approved aggregate CPU/RAM budget across them, not multiplying this table.

There is no global playback-session or media-reservation admission limit for Free or VIP videos. Each account may hold at most two VIP playback sessions; Free does not use that account allowance. The existing per-session parallel media-request policy remains configurable at one or two. Discovery and metadata each retain one background worker, independent of media activity.

Go optionally paces each media response at `STREAM_MAX_BYTES_PER_SECOND`; Compose defaults to 262,144 bytes/second. This is a per-response pace, not an aggregate viewer or upstream cap. Aggregate traffic and memory grow with concurrent requests; higher-bitrate original files may buffer at this pace. CPU/RAM ceilings and network/Telegram capacity still constrain physical throughput.

## Reused and completed components

Reused: website login/CSRF/session cookies, Clerk/database-approved administrator roles, manual membership approval, `PlaybackSession`, `VideoView`, library/profile records, asymmetric grants, opaque public IDs, exact Range handling, bounded gotd part reads/reference refresh, cancellation and the existing reverse proxy.

Inspection found that Module 4.3 had four-hour playback records and grant renewal, but did not implement the new two-session allowance, shared playback/upstream budgets, pause/recovery deadlines, per-minute cleanup, key rotation or active-session administration. Those requirements are implemented on the existing models rather than assumed to exist.

## Persistent capacity and lifecycle

PostgreSQL is the authority. VIP admission uses a transaction advisory lock scoped to that account. Counts and insertion use a fresh statement snapshot **after** obtaining that lock, enforcing two sessions across API instances. Upstream admission locks only the same playback context and enforces its parallel request allowance. Free admission has no global lock or viewer count. Production deadlines use PostgreSQL time. Historical `PlatformSettings.playbackLimit` and `upstreamLimit` columns remain unchanged for compatibility but are ignored, including existing zero/two values and old environment settings.

`PlaybackSession.reservedUntil` represents the playback slot. `UpstreamLease` separately represents media/history work; a playback can make multiple HTTP requests without creating another playback reservation. Go generates an independent upstream reservation ID per HTTP request, obtains it from the private Node check, renews it with active-connection checks and releases it on completion/cancellation. A crash leaves only a bounded lease. Metadata work uses a distinct lease kind, excluded from data-upstream counts, and at most one shared metadata job runs at a time.

| Rule | Implementation |
| --- | --- |
| VIP account allowance | Two active reservations; third returns 429 `VIP_STREAM_LIMIT` |
| Global viewer/media admission | No fixed application counter; no existing stream is evicted for a new viewer |
| Playing/buffering | Heartbeat every 30 seconds; reservation extends 90 seconds |
| Disconnected | Same identity can recover within its 90-second reservation |
| Paused | Fixed ten-minute window from the pause transition; repeated paused reports do not reset it |
| Recovery expired | 410; browser creates a fresh request identity on retry |
| Cleanup | Every minute; indexed, bounded batches; idempotent across instances |
| Overall limits | Existing four-hour session and three-hour HTTP request limits remain |

Cleanup marks expired playback records; it does not delete their progress or analytics. It removes expired upstream leases and seven-day security-event records in bounded batches. Active counts exclude expired and terminated states as well as expired deadlines. A late disconnect cannot overwrite a newer pause heartbeat.

Migration `202611020006_session_lifecycle` adds playback state/reservation/pause deadlines, request idempotency, coarse client labels, progress timestamps and an optional error field to the existing playback table. It adds source status/backoff fields to videos, approved capacity fields to platform settings, the upstream-lease and aggregated-security-event tables, a unique playback-session reference on qualified views, and indexes for admission, cleanup, account/device lookup and resume. Existing playback deadlines are backfilled from their prior expiry/heartbeat. Existing videos, accounts, memberships, progress and analytics are preserved.

The browser stores an opaque request/session identity in **tab-scoped session storage**. It supplies `requestId` for idempotency and `sessionId` for recovery; cookies alone do not define a new playback intent. Requests without an idempotency identity retain legacy API semantics and are treated as new intents. Recovery validates viewer ownership, the website login session and current video policy. Ordinary website tabs do not create login sessions or consume VIP slots until they authorize a player.

`node scripts/playback-budget.mjs --per-session 1 --reason "approved explanation"` configures only per-session parallel media requests and records an audit event. The historical filename is retained. Old `--playbacks` and `--upstreams` arguments are rejected before database access. No global settings are written or reset by this update. No new migration or application-data rewrite is needed.

## Authorization, expiry and key rotation

Node continues to decide access; Go validates RS256 signatures, issuer, audience, exact video/session/context, lifetime and the current lease. Private Telegram mappings never come from the browser. Playback cookies remain HttpOnly, host-only, SameSite=Strict, Secure in production and scoped to `/api/playback/<session>/stream`.

New grants include `kid`, derived from the canonical public key unless `PLAYBACK_KEY_ID` is configured. Current and up to two previous public keys can be configured. Each previous key has an explicit `acceptUntil`, at most 24 hours ahead when loaded. Unknown, retired, duplicate or invalid keys fail closed. Go receives public keys only. Neither images nor Go receive the private signing key.

Both verifiers allow up to 30 seconds of configurable future issued-at clock skew while explicitly rejecting already-expired grants. Expiration is not extended by clock tolerance. Keep clocks synchronized; no OS/NTP settings were inspected or changed.

Rotation procedure:

1. Deploy matching Node/Go versions with the existing pair; wait beyond the previous grant lifetime so clients have `kid` grants. Legacy grants without `kid` are accepted only with the current key.
2. Provision a new private/public pair outside Git/images and derive/set its new `kid`.
3. Place the previous public key, old `kid` and finite ISO `acceptUntil` in a server-side JSON file: `{"keys":[{"kid":"old-id","publicKey":"PEM","acceptUntil":"ISO time"}]}`.
4. Mount that public-only file into Node and Go and coordinate their restart with the new current pair. Never copy the old private key into Go.
5. Verify overlap and rejection at cutoff, then remove the old key. An open response carrying a retired original signature can close and require retry/resume with a new grant even when its database session remains recoverable.

Every new GET/HEAD/Range requires an unexpired grant and current Node authorization. Open HTTP bodies have Go's hard lease timer and periodic private checks. Renewal can extend the same connection without replacing the video element. Revocation/classification/account changes reject new requests immediately and cancel open responses at the next check (15-second polling plus up to five seconds for the callback, subject to process scheduling).

A database/verification outage grants no new authorization or renewal. An open response may use only its last confirmed bounded lease; a failed check never extends it. The earliest known grant/membership/session/recovery deadline ends delivery. The 90-second lifecycle deadline can precede the five-minute JWT deadline. Already-delivered or buffered bytes cannot be recalled; this is not DRM.

## Account, progress and administration

Single-device logout atomically revokes that login and its playback records. Other devices remain active. Logout everywhere and password changes revoke all login/playback records; password changes require current-password verification. Suspension also revokes playback. Membership records are not revoked by playback termination or logout.

Playback sessions, Security events and Operations reuse administrator authorization. OWNER is the existing super-administrator equivalent. OWNER/ADMIN can terminate playback; security/operations views are owner-only. Termination requires a reason, locks the target record, records administrator/time/reason in the audit log and ends its reservation. Go cancels associated work on enforcement. No grant, private key or Telegram source reference appears in session listings.

Progress remains separate from qualified views. Each playback keeps its position/update time; authenticated resume avoids substituting another actively playing device's progress. Local progress remains a fallback. The player reports every 30 seconds and on pause/page exit where possible and offers Resume/Start Over. Exit reporting is best-effort.

Qualified views retain server-time/movement validation and daily device/account deduplication. The threshold is 30 reported playback seconds or half a known duration below 60 seconds. Paused, buffered, seeking and implausible intervals receive no credit. A unique `playbackSessionId` enforces at most one qualified view per playback. Free/VIP analytics remain separate and public cards hide view counts. Client reports cannot prove human attention.

## Security follow-up — November 3

Renewal, recovery and signed active-stream checks persist permanent denials as terminated playback. Expired-login cleanup requires the recognized login cookie, matching CSRF and bound viewer/session. Invalid cookies, bad CSRF and cross-video recovery cannot terminate somebody else's playback. Temporary source errors, maintenance and database outages retain bounded recovery.

Heartbeat denials revoke only after their transaction rolls back and releases its row lock. The client revalidates access after denial and stops/removes the source when access is lost. Stale callbacks from an unmounted player cannot stop a replacement. Retry identities are cleared for expired/revoked access.

The final authorization write checks live state, deadlines, video visibility/classification, viewer, website login, account status and membership in one conditional SQL update. Termination during signing cannot issue a renewed live cookie. Expiration is checked again after the write. Upstream work leases stay tracked until Go cancels/releases them, preserving ownership and the per-session request allowance.

Signed-in Free authorization requires CSRF; anonymous Free retains origin/content-type protections. Valid media requests have an existing 180-per-minute allowance per verified, browser-bound playback session per API instance, independent of IP changes. Invalid grants use a separate trusted-client-IP bucket and cannot spend a valid session's allowance. Signature/policy checks precede charging that allowance. Short API/control concurrency, database pools and CPU/RAM protections remain; open media bodies do not count toward the short-request guard. Request buckets are bounded and expiry pruning runs at most once a second.

Admin sessions/security views refresh every 30 seconds while visible and on return, with one in-flight refresh and a ten-second deadline. Refresh preserves an open termination form and prior data on transient errors, displays the last successful time and clears protected records on 401/403.

The native player retains browser-managed forward buffering and metadata preloading. No strict client buffer-duration ceiling is claimed. Already-delivered bytes cannot be recalled. No cache, transcoding, download feature or new migration is added by this capacity update.

## Source reliability and monitoring

Bounded gotd reference refresh, DC migration, transient retries and cancellation remain. Missing/non-video sources leave the Go catalogue and become unavailable in PostgreSQL while history remains. Temporary errors retain publication/classification and use bounded per-video backoff from 30 seconds to 15 minutes. Successful trusted reads clear transient status; clean discovery can restore a source. Invalid catalogue entries are skipped without treating them as deleted.

Free and VIP responses retain `Cache-Control: private, no-store`. Range/HEAD/206/416, bounded parts, pacing and disconnect cancellation remain in the original handler. The player probes media failure status so authorization/source errors are not automatically labelled codec failures.

Operations measures Hub processes/containers only: API/Go CPU/RAM and available cgroup/network/disk counters, filesystem space, active sessions/leases, database connections, failures, authorization failures and Go request/DC-pool/source metrics. Missing counters display unavailable. Active session/media totals are informational; no global-capacity-full warning remains. Memory/disk warnings remain. No host inspection, other-project monitoring or external alert recipient was introduced.

Security events are allowlisted and aggregated per minute through a bounded worker, retained seven days and may be sampled during floods. Logs are aggregated/sampled and Docker logs rotate. Caddy redacts credentials, grants and cookies. No privileged host-monitoring container or Docker socket is mounted.

## Deployment and rollback

These are operator instructions, not actions performed by the capacity update. For the first deployment use `compose.coolify.yaml` alone, as described in [the current guide](first-production-deployment.md); it now contains the complete Hub stack without host port bindings. Configure only Hub's proxy domain/internal port 80. Do not replace shared ingress, take ports 80/443 or change unrelated networks. The first-deployment definition does not require `!reset`.

1. Back up application data, Telegram session, keys and configuration through the operator's existing location. Keep keys/session backups encrypted and outside Git/public roots.
2. On the original Module 5 upgrade, apply the additive `202611020006_session_lifecycle` migration through the normal entrypoint. The capacity update needs no further migration or data rewrite.
3. Mount matching keys and optional previous-public-key JSON. Private PEM belongs to Node UID 1000 only (for example mode 0600); Go UID 10001 needs only public material.
4. Retain configurable Hub CPU/RAM and per-response pacing. The audited script configures only per-session parallel requests. No global playback/upstream cap is configured.
5. For a separately authorized deployment, validate merged Compose and restart only Hub, then check real HTTPS, cookies, seek/resume, private-port isolation and log redaction.
6. Any future load test needs separate authorization. No measured safe concurrency or automatic resource/replica increase is claimed.

`PLAYBACK_DRAIN=1` manually pauses new playback while permitting recovery. Roll back to coordinated Node/Go images with matching keys and resources, leaving additive columns/tables in place. Do not reset/down-migrate or erase records. An older image may reintroduce global admission caps or lack lifecycle protections; restoring a backup is a separate reviewed recovery operation.

Use a server-major-compatible `pg_dump` and test `pg_restore` only in an isolated database/schema. The backup test never uses `--clean` on application data. The earlier local client/server mismatch blocked the round-trip; backup verification remains outstanding. Migration tests do not substitute for backups.

## Historical implementation validation record

The earlier security follow-up passed 78 Node checks (eight opt-in cases skipped), public/admin builds, Go packages, isolated Module 5 lifecycle tests and all seven Module 4.3 authorization scenarios. Module 4.1/4.2 passed earlier; they were not repeated in that follow-up. The earlier global final-slot rejection test has been replaced by successful independent admissions in the capacity update. See the [current report](module5-capacity-update.md) for this task's exact results.

Earlier bounded real Telegram checks passed HEAD 200, exact ranges 206, invalid Range 416 and missing grant 401, preserving seven existing VIP records and historical views. Actual FFmpeg extraction passed ranged MP4/MKV and black-frame rejection. Base/shared-Coolify Compose validation passed with placeholders. These checks were not new production or load tests.

In-app Chromium previously decoded anonymous Free H.264 and advanced to 22.94 seconds; reload was initiated but not verified. Native Windows automation could not complete and later failed initialization. Native Chrome/Edge, physical Android/iPhone/Safari, slow networks, production TLS, container execution and VPS reboot/load remain unverified. No claim of physical viewer capacity follows from local fixtures. Full metadata snapshots are still exchanged; large catalogues have not been load-tested.

Earlier runs exposed and corrected lock contention, excess database round trips, missing raw-insert UUIDs, analytics-facade assignment, expiry fixture timing and expected statuses after revocation. A cold remote connection needed a bounded five-second transaction checkout. Fake-clock cleanup must finish before rewinding; initially unreported test sessions must send the real paused heartbeat rather than weakening the production abandoned-session rule. Backup attempts stopped on client/server mismatch before restoring anything.

The following cumulative file inventory includes earlier Module 5 work, including its original additive migration and Hub-only deployment preparation. It does not mean those protected files were changed by the capacity update.

## Exact changed files

Paths are relative to the repository root. This is the current cumulative working-tree file list, including newly added files.

```text
.env.example
apps/admin/src/AdminUI.jsx
apps/admin/src/Management.jsx
apps/admin/src/Module42.jsx
apps/admin/src/Operations.jsx
apps/admin/src/PlaybackSessions.jsx
apps/web/src/components/AccountSecurity.jsx
apps/web/src/components/ProfileDesign.jsx
apps/web/src/hooks/useAccount.jsx
apps/web/src/hooks/usePlayback.mjs
apps/web/src/hooks/useQualifiedView.mjs
apps/web/src/pages/Video.jsx
compose.coolify.yaml
compose.yaml
docs/module43.md
docs/module5.md
infrastructure/docker/Caddyfile.coolify
infrastructure/docker/playback-previous.empty.json
README.md
scripts/playback-budget.mjs
scripts/qa-playback.mjs
scripts/test-database.mjs
services/api/prisma/migrations/202611020006_session_lifecycle/migration.sql
services/api/prisma/schema.prisma
services/api/src/administration.mjs
services/api/src/application.mjs
services/api/src/catalogue-sync.mjs
services/api/src/config.mjs
services/api/src/database.mjs
services/api/src/domain.mjs
services/api/src/media-metadata.mjs
services/api/src/memory-pressure.mjs
services/api/src/operations.mjs
services/api/src/playback-capacity.mjs
services/api/src/playback-grants.mjs
services/api/src/playback.mjs
services/api/src/security-events.mjs
services/api/src/server.mjs
services/api/src/source-status.mjs
services/api/src/thumbnails.mjs
services/stream-go/cmd/stream-service/main.go
services/stream-go/internal/observability/container.go
services/stream-go/internal/playback/auth_test.go
services/stream-go/internal/playback/auth.go
services/stream-go/internal/playback/keys.go
services/stream-go/internal/streaming/http_test.go
services/stream-go/internal/streaming/http.go
services/stream-go/internal/streaming/pool.go
tests/helpers/playback-database.mjs
tests/module41-database.test.mjs
tests/module43-database.test.mjs
tests/module5-backup.test.mjs
tests/module5-capacity.test.mjs
tests/module5-database.test.mjs
tests/module5-operations.test.mjs
tests/playback-grants.test.mjs
tests/playback-request-rate.test.mjs
```
