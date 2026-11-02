# Habeshan HUB

React public and administrator frontends, a Node.js application API using Prisma/PostgreSQL, and the existing Go/gotd Telegram discovery and HTTP Range service. Public browsing stays anonymous. Username/password accounts, qualified video views, membership packages and manual subscription processing now persist in PostgreSQL.

## Local Windows setup

Use Node 22.12+ and the existing root `.env`. Keep the exact server variable `DATA_BASE_URL`; never put database or Telegram credentials in a `VITE_` variable. The existing `.env` was preserved.

```powershell
npm.cmd ci
npm.cmd run db:generate
npm.cmd run db:migrate
node scripts/playback-keys.mjs
npm.cmd run runtime:build
npm.cmd run runtime:go
```

In separate terminals:

```powershell
npm.cmd run runtime:api
npm.cmd run dev
```

Open [Habeshan HUB](http://127.0.0.1:5173). The Go service scans accessible history and maintains its resumable metadata checkpoint. Node imports that existing catalogue into PostgreSQL every 15 seconds. Internal video IDs, Telegram session reuse and original byte-range delivery are preserved. Public URLs now use opaque UUIDs. Source video files/chunks are not cached on VPS disk.

For first Telegram login only, use `npm.cmd run go:build`, then `npm.cmd run stream -- -mode find`. Enter phone/code/password in that terminal. Stop the legacy streamer before starting the daemon with the same session. Local wrappers keep private generated service tokens in ignored `.local/runtime.json`.

The separate administrator application runs with `npm.cmd run dev:admin` at [the local admin URL](http://127.0.0.1:5174). Module 4.2 now provides video/user/membership/comment management, real analytics, database settings and append-only audit history. Google sign-in uses `CLERK_PUBLIC_KEY` and `CLERK_SECRET_KEY`. `EMAIL` and `USER_NAME` bootstrap the first owner once; later administrator approvals are made only inside the dashboard and checked against PostgreSQL. There is no public administrator registration. [Full implementation report](docs/module42.md).

## Account-owned profile

Guests see only Log in and Sign up. Signed-in profile identity, watched history, likes, watchlist and membership now use the authenticated account. See [profile implementation and checks](docs/account-profile.md). Legacy device records remain preserved and are not imported into accounts.

## Module 4.3 playback access

[Implementation, tests and deployment report](docs/module43.md) describes per-video VIP/FREE classification, Node-issued RS256 grants, private Go verification, renewal and monitored active connections. Discovered videos default to VIP. Administrators can mark individual videos Free without changing their visibility. Free videos are public and excluded from VIP Trending. Existing global streaming-access settings are retained as legacy data; per-video policy now controls playback.

Generate server keys before starting the API and Go service; the helper preserves existing keys and never edits `.env`. Production must mount the private key only into Node and the public key into both services. New grants and Range requests always recheck current access. Active connections have a hard lease deadline and periodic revocation checks; this cannot recall bytes already buffered by a browser. Deployed HTTPS/Coolify routing still needs verification on the actual VPS.

## Module 4.2 administration

[Administration and acceptance report](docs/module42.md) lists all seven management sections, role checks, API changes, tests and remaining deployment checks. Migration `202611020004_admin_management` is additive. Video overrides survive Telegram discovery; hiding blocks direct media URLs. Platform support, packages, registration and access settings persist in PostgreSQL. Database outages now fail media/catalogue access closed so hidden content cannot leak through the old fallback.

## Module 4.1 foundation

[Implementation and acceptance report](docs/module41.md) documents the schema, endpoints, view-count rules, membership lifecycle, checks and remaining configuration. Migration `202611020001_module41` was applied to the inspected database without a reset. The packages are stored as Monthly **990 ETB**, Yearly **2,990 ETB**, and Long-term **6,000 ETB** (144 months).

A subscription request is saved with its reference and package/price/username snapshot before a human Telegram conversation can be opened. The real support account is pending the user's details. No username, bot or successful payment has been invented. Payment proof stays in the human conversation; approval is a separate administrator action.

Actual video metadata supplies Longest sorting; missing durations are inspected through bounded FFmpeg Range reads. Most Viewed and Trending use qualified PostgreSQL view events. Stream requests, thumbnails, reloads and seeking alone do not add views. Public cards do not display view counts.

[Video covers](docs/video-previews.md) are extracted from actual videos using FFmpeg on PATH or `FFMPEG_PATH`. The Windows wrapper also detects `.tools/ffmpeg/bin/ffmpeg.exe`; the API image installs FFmpeg. Only JPEG images are cached in memory. Unsupported source codecs still depend on browser support; Range delivery does not transcode them.

## Production and structure

[Operations](docs/automatic-streaming.md) and [verification history](docs/runtime-verification.md) cover discovery, health, deployment and actual versus untested checks. Compose builds the public/admin frontends, Go runtime, Node API and HTTPS reverse proxy. The API runs additive migrations and idempotent package seeding before starting. PostgreSQL uses the configured external `DATA_BASE_URL`; no duplicate database or Telegram service is created. Only the reverse proxy publishes ports. Public browsing no longer has the old operator Basic Auth gate; administrator operations require backend-verified Clerk authorization.

| Directory | Responsibility |
| --- | --- |
| `apps/web` | React catalogue, player, accounts and membership flow |
| `apps/admin` | Independent React administrator app, production base `/admin/` |
| `services/api` | Node API, Prisma schema/migrations, authentication, statistics and streaming gateway |
| `services/stream-go` | Existing gotd client, session, discovery/checkpoint and Range streaming |
| `packages/shared/types` | Shared public contracts |
| `infrastructure/docker` | Production builds and Caddy routing |
| `scripts` | Build, migration, runtime and acceptance commands |
| `tests` | HTTP, domain, streaming and isolated database checks |

The old local catalogue adapter and earlier code remain for fixtures/diagnostics. Runtime traffic uses the synchronized API. Historical design notes are in [the earlier foundation README](docs/frontend-foundation-legacy.md).

## Checks

```powershell
npm.cmd test
npm.cmd run test:database
npm.cmd run build
node scripts/verify-runtime.mjs
node scripts/verify-module41.mjs
```

The database test creates and removes a randomly named test schema, leaving live application accounts/payments untouched. Live verification requires the running local services and PostgreSQL. To include actual FFmpeg fixtures in the full suite, set `RUN_FFMPEG_TESTS=1` and `FFMPEG_PATH` if FFmpeg is not on PATH. `RUN_DB_TESTS=1` includes the isolated database workflow in `npm test`.

Container image builds, server crash/reboot recovery, TLS and a Coolify deployment still require the target Docker/VPS environment. Prepared configuration is not a claim that those checks passed.
