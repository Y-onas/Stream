# Module 5 — Global playback capacity update

November 3, 2026. This updates the existing streaming implementation. It does not deploy it or promise unlimited physical capacity.

**Subsequent policy change:** the owner also requested removal of fixed CPU/RAM quotas and stream pacing. See [the resource and speed update](module5-resources-update.md). Resource-preservation statements below describe this earlier capacity-only change; the later request explicitly supersedes those allocations.

## Current policy

- No global concurrent playback-session limit for VIP or Free.
- No global concurrent media-upstream reservation limit. Go's process-wide media semaphore and Node's whole-response admission count have been removed from the media path. The fixed Node TCP connection ceiling was also removed.
- Two simultaneous VIP playback sessions per account remain enforced in PostgreSQL across API instances. Free sessions do not consume this allowance. New viewers never evict existing VIP streams.
- No maximum number of Free titles was added. Administrators still choose Free classification and publication.
- Existing per-session parallel media requests remain configurable at one or two. They bound one playback's request fan-out, not the number of viewers. Discovery and metadata each retain one independent background worker; media totals cannot prevent either worker from running and worker counts cannot block media admission.

Historical `PlatformSettings.playbackLimit` and `upstreamLimit` values remain in the database but are never consulted for admission. Old `PLAYBACK_GLOBAL_LIMIT`, `TELEGRAM_UPSTREAM_LIMIT` and `STREAM_CONCURRENCY` environment values are ignored. The example and Hub Compose environment entries have been removed. No replacement large-number global limit is used.

The historical `scripts/playback-budget.mjs` command now changes only `--per-session 1|2`, with a required `--reason` and audit event. Retired global arguments are rejected before database access. The command was not run against application data during this update.

## Session tracking and security

VIP creation serializes only the same account. Media lease creation/renewal serializes only the same playback context. Counts are read after acquiring those transaction locks, retaining concurrency safety across instances without a platform-wide admission lock.

Request idempotency, viewer/account ownership, individual playback and upstream records, 30-second heartbeats, fixed ten-minute pause windows, 90-second disconnect/abandonment recovery and four-hour playback expiry remain. Per-minute cleanup keeps its existing advisory lock, indexed bounded batches and safe handling of concurrent work. It expires stale sessions without deleting history/progress, and removes expired upstream leases. Expired or wrong-owner leases cannot be renewed.

Authentication, CSRF, suspended-account restrictions, membership validation, current/previous signing keys, signed Node-to-Go grants, scoped secure playback cookies, renewal/revocation and administrator termination remain. Every new Range/HEAD/GET requires authorization. Go retains periodic policy checks, hard authorization deadlines and cancellation of open responses. Membership expiration still bounds an active stream; buffered bytes cannot be recalled.

Progress and qualified views are unchanged. Free and VIP analytics remain separate. Source discovery/reference refresh, HTTP Range/206/416 seeking, bounded Telegram reads, cancellation/backpressure and source failure handling remain. No persistent video/chunk cache, transcoding, download endpoint or CDN was added.

## Files changed by this update

Paths below are relative to the repository root; earlier uncommitted Module 5 work was preserved.

| Area | Files |
| --- | --- |
| Admission, leases and errors | `services/api/src/playback-capacity.mjs`, `playback.mjs`, `server.mjs`, `security-events.mjs` |
| Configuration and operations | `services/api/src/config.mjs`, `operations.mjs`; `apps/admin/src/Operations.jsx`; `scripts/playback-budget.mjs`; `.env.example` |
| Go | `services/stream-go/cmd/stream-service/main.go`; `internal/streaming/http.go` (pacing comment only); `internal/playback/testserver/main.go` (per-request fixture handler matching production) |
| Database compatibility | `services/api/prisma/schema.prisma` (comments identifying historical ignored fields only) |
| Hub deployment environment | `compose.yaml` (remove the three obsolete global-cap environment entries only) |
| Tests | `tests/api-runtime.test.mjs`, `module5-capacity.test.mjs`, `module5-database.test.mjs`, `module5-operations.test.mjs`, `helpers/playback-database.mjs` |
| Documentation | `README.md`, `docs/automatic-streaming.md`, `docs/module5.md`, this report |

**Migrations: none added or changed.** No application data reset, deletion, backfill or configuration rewrite was performed. Database tests use disposable randomly named schemas. Legacy cap values are explicitly checked to remain unchanged after testing the new policy.

Baseline hashes confirm all six existing migration files, root `.env`, both proxy files and the shared-Coolify overlay are unchanged by this task. Hub CPU/RAM/swap/PID allocations, ports, networks, logging and shutdown configuration are unchanged. No shared ingress, unrelated project or production service was inspected, modified or restarted.

## Verification

| Check | Result |
| --- | --- |
| `node --test tests/*.test.mjs` | 80 passed, 0 failed, 8 opt-in checks skipped |
| `node scripts/go.mjs test` | All Go packages passed, including authorization/key rotation, Range and cancellation tests; service/test-fixture packages compiled |
| `npm.cmd run build` | Public and administrator production builds passed |
| `RUN_DB_TESTS=1 node --test --test-concurrency=1 tests/module5-capacity.test.mjs tests/module5-operations.test.mjs tests/module5-database.test.mjs tests/module43-database.test.mjs` | 22 passed, 0 failed, 0 skipped; disposable PostgreSQL schemas and actual Node/Go authorization/streaming fixture |

Focused coverage includes legacy global limits of `1` being ignored, multiple Free viewers and another VIP account, a two-client race for one account's second VIP slot, lease ownership/renewal/cleanup and independent bounded background work. A deterministic local HTTP test holds 33 tiny synthetic media bodies open and confirms media and catalogue requests still pass; it is a counter regression, not a throughput/load benchmark. Go integration uses disposable synthetic bytes, including three simultaneous media responses and an additional exact Range response.

The first Node run exposed a missing `close()` method in the new test mock during teardown. That fixture was corrected; the focused rerun and full suite then passed. No production behavior was weakened to satisfy the test.

Opt-in FFmpeg and backup checks are skipped in the ordinary Node suite; opted-in database checks are run separately. This update does not change codecs, extraction or backup behavior. No real Telegram/VPS load testing, deployment, container rollout, external TLS test or physical-device acceptance was performed.

## Remaining constraints

CPU/RAM allocations and per-response pacing remain configurable for future infrastructure upgrades. Current Compose defaults still total 0.50 CPU core and 928 MiB RAM across Hub containers. The unchanged 262,144-byte/second pace applies to each response and may buffer high-bitrate originals; it is not an aggregate viewer limit. Aggregate traffic and memory increase with viewers.

Container memory pressure (85%) and manual drain can temporarily refuse new playback for their stated resource/operational reasons. Short API/control requests retain their separate 32-in-flight overload guard; long media bodies do not consume it. Existing per-session request-rate/fan-out protections, database pools/timeouts, bounded background workers, OS/socket resources, network bandwidth and Telegram availability/flood responses still affect service. These are not claims of verified support for 10,000 concurrent viewers or of unlimited physical capacity.
