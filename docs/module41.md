> Current Module 4.2 updates administrator authorization to approved database emails and adds visibility, moderation and platform settings. See [the current implementation](module42.md). Earlier foundation notes below retain their historical context.

> Subsequent account-profile changes add real Watched, Liked and Watchlist collections and guest-only login/signup. See [the profile refinement](account-profile.md). Earlier scope statements below describe the Module 4.1 baseline.

# Module 4.1 — Database, real statistics and manual membership workflow

Implemented and verified on 2026-11-02. Live Clerk setup is deferred to Module 4.2 at the user's request; the human Telegram contact is pending the user's details. Neither has been simulated.

## Existing architecture retained

Inspection found an accessible, empty PostgreSQL database, no existing Prisma models or account authentication, separate React public/admin foundations, and an already working Go/gotd discovery/session/Range service. The Go metadata checkpoint remains the discovery recovery mechanism. Node imports its stable video IDs into PostgreSQL; no second Telegram client, media store or replacement streamer was added. The root `.env` and exact `DATA_BASE_URL` name were preserved.

| Technology | Responsibility | Reason |
| --- | --- | --- |
| React | Public catalogue/player/account and separate admin UI | Extends existing frontends |
| Node.js | Application API, authorization, memberships and statistics | Keeps application logic in the existing API |
| Prisma | PostgreSQL access and additive migrations | Typed models, transactional writes |
| PostgreSQL | Users, sessions, video metadata, views, requests, memberships and audit | One durable application database |
| Go + gotd | Existing Telegram discovery and media retrieval | Reuses the authorized MTProto session |
| HTTP Range | Requested video portions and seeking | Original partial-stream implementation |
| FFmpeg | Real cover frames and missing container durations | Bounded reads from the original stream |
| Reverse proxy + HTTPS | Public routing, private gateway and secure cookies | Backend ports/tokens stay private |

No VPS video disk cache is used. Go persists only discovery metadata/checkpoints and its private Telegram session. Thumbnail JPEGs have a bounded memory cache. Source streams remain incremental.

## Migration and data

Applied `services/api/prisma/migrations/202611020001_module41/migration.sql` using `prisma migrate deploy`; recorded in `_prisma_migrations`. No reset, destructive baseline or removal of existing records was performed. The migration creates:

- `hh_users`, `hh_user_sessions`, `hh_viewer_sessions`;
- `hh_videos`, `hh_playback_sessions`, `hh_video_views`;
- `hh_membership_plans`, `hh_subscription_requests`, `hh_memberships`, `hh_admin_audit_logs`.

Constraints include canonical case-insensitive unique usernames, unique request references, one pending request per user/package, one membership per approved request, and device/user daily view deduplication. Foreign keys and query indexes preserve history and support catalogue/admin pagination.

Idempotent seeding created Monthly / 1 month / 990 ETB; Yearly / 12 months / 2,990 ETB; Long-term / 144 months / 6,000 ETB. Amounts are stored as integer minor units. `MEMBERSHIP_CURRENCY` defaults to ETB. Seeding does not overwrite later package edits; request and membership snapshots preserve historical terms.

Seven actual Telegram videos were imported automatically, with seven distinct measured durations. No live test users, payment requests or memberships were inserted. The one persisted qualified view came from actual browser playback of the real Verity MP4, not a synthetic production event.

## Account and subscription behavior

Public browsing and playback do not require an account. Normal accounts use usernames and passwords, with scrypt hashing, database-enforced canonical uniqueness, opaque hashed session tokens, HttpOnly/SameSite cookies (Secure in production), exact-origin mutation checks, CSRF protection and bounded authentication attempts. Username availability checks only the entered name. There is no public user directory or Google login for normal users.

A chosen package survives the registration/login transition. Creating a request saves a unique `HH-…` reference and username/package/price/currency/duration snapshots before exposing a Telegram handoff. Duplicate concurrent pending submissions return the same request. The user then opens the human account conversation and manually sends a draft containing the username, package, amount and reference. Copyable message/reference remain available when a Telegram app/link cannot open. No bot, automated message, screenshot ingestion or payment verification integration exists.

The real human account is unconfigured. `TELEGRAM_SUPPORT_USERNAME` accepts a human public username or direct `https://t.me/username` link. A numeric Telegram account ID is not converted into an invented public username. Until the user provides a usable contact, requests can be saved and copied, but a live correct-recipient conversation cannot be acceptance-tested.

The administrator records manual verification, internal notes and approval/rejection. Row locks, optimistic versions, a unique membership request key and a transaction prevent duplicate activation. Approval stores the Clerk administrator ID, activation time and expiry calculated from activation with calendar-month clamping. Rejection does not activate membership. Suspension revokes account sessions; restoration and membership revocation create audit records. Notes and payment-review details are absent from public responses. Profile membership status/history comes from PostgreSQL and refreshes while open.

## Views, rankings and durations

A playback session starts on actual player playback. Valid sequential heartbeats credit only plausible forward progress, capped by server wall time. Qualification requires 30 seconds of active progress, or half the duration for videos shorter than 60 seconds (minimum one second). Pauses, hidden-page intervals, seeks, jumps, replayed sequence numbers and Range/thumbnail requests do not independently qualify a view.

At most one view per video/device viewer cookie/UTC day is stored. Authenticated views additionally deduplicate by video/user/UTC day across devices. Viewer/session tokens are random, hashed in PostgreSQL; IP addresses and browser fingerprints are not stored as view identities. This is practical abuse resistance, not a claim that client playback telemetry is impossible to forge. Cookie clearing and new anonymous devices cannot be perfectly unified without identifying people.

Most Viewed sorts persistent qualified-event totals before pagination. Trending and administrator today/week/month totals use calendar periods in `APP_TIMEZONE` (default Africa/Nairobi); weeks start Monday. Empty activity produces an honest empty Trending section. Public video DTOs/cards omit view counts; administrators see real totals.

Longest sorts measured duration descending, missing values last, before pagination. Telegram-provided durations are reused when present. Otherwise the existing FFmpeg range broker reads container metadata with a 16 MiB/48-read/90-second budget, no full video download and no video disk cache. Failures remain null and retry later; caption guesses are not treated as measured values. Real MP4 browser playback and all seven duration values were verified.

## API additions

All routes remain behind the existing trusted gateway; normal-user and administrator authorization are independent. See [contracts](api/contracts.md) for the route list.

- Public configuration, database packages and server-paginated catalogue/search/Most Viewed/Longest/Trending.
- Username availability, registration, login, session lookup and logout.
- Saved subscription creation/private reference lookup and current/history membership.
- Playback-session creation and qualified heartbeat processing.
- Administrator configuration, overview, users/details/status, requests/details/manual processing, memberships/revocation, video statistics and audit history.

Existing `/api/videos/:id/stream` and `/thumbnail` keep using the original Go media path. Database outages fail account/ranking mutations clearly; Latest can fall back to the Go catalogue and existing Range delivery continues. API readiness checks both Go readiness and access to application database tables.

## Administrator configuration deferred to Module 4.2

The independent `apps/admin` code is prepared for Overview, Users, Subscription Requests, Memberships, Videos and Audit Logs. Its backend verifies signed Clerk tokens, exact authorized origin, an explicit `ADMIN_CLERK_USER_IDS` allowlist and a Google-connected Clerk account. Signing in with any Google account alone does not grant administrator access. Missing credentials fail closed; there is no local administrative bypass.

The user will add Clerk credentials in the environment later. Configure `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, optional `CLERK_JWT_KEY`, `ADMIN_CLERK_USER_IDS` and `ADMIN_ORIGIN`, with Google enabled in that Clerk project. Live OAuth and real dashboard operations await Module 4.2. RSA token signature/origin verification and allowlist rejection were tested without claiming a live Clerk login.

## Verification

- **28/28 Node tests passed, zero skips**, with real FFmpeg fixtures and the real PostgreSQL workflow enabled. Database fixtures use a randomly named disposable schema and remove it afterward; no fake public accounts or payments are retained.
- Isolated database checks passed registration races/case uniqueness, password hashes, username availability, login/logout, unauthorized admin rejection, CSRF rejection, package snapshots, duplicate pending requests, private request lookup, manual verification, concurrent duplicate approval, exact activation/expiry, rejection, suspension/restoration, revocation and audit history.
- View checks passed no counting from thumbnails/Range/seeking, qualified accumulation, refresh/replay prevention, authenticated association, cross-device user deduplication, real SQL period totals, Most Viewed/Longest ordering, null durations, pagination and persistence after reconnect.
- Database failure checks passed sanitized errors, safe account/ranking failure and preserved original streaming.
- Both public/admin production builds passed, including `/admin/` assets.
- Prisma schema validation and Compose syntax validation with placeholder credentials passed. The Docker engine was unavailable, so image execution was not tested.
- Actual browser inspection verified ETB packages, selected-package persistence through account navigation, real measured Longest ordering, and real decoded MP4 playback. Real view persistence and HTTP Range behavior were checked again after restarting Node; see `.local/qa/module41-verification.json` and `.local/runtime-verification.json` for the bounded live results.

Run `npm run test:database` for the isolated workflow. For the complete acceptance suite in PowerShell: `$env:RUN_DB_TESTS='1'; $env:RUN_FFMPEG_TESTS='1'; npm.cmd test` (set `FFMPEG_PATH` if necessary).

## Deployment and remaining work

The API image installs FFmpeg/OpenSSL, generates Prisma and retains the migration CLI as a production dependency. Startup applies additive migrations and idempotent seeds before listening. Compose uses the existing external PostgreSQL URL, DB-aware readiness, private backend networking and persistent Go session/checkpoint volumes. Caddy allows anonymous browsing, replaces the private gateway header and forwards Clerk bearer authorization. The old whole-site Basic Auth settings are no longer required.

Still pending: the user's real Telegram contact; live Clerk/Google configuration and full administrator UX validation in Module 4.2; an actual human Telegram/payment/approval round trip; production domain/TLS/Coolify deployment, Docker image execution and server crash/reboot/load/backup acceptance. No deployment occurred here. Password recovery, normal-user social login, automated payments, bot delivery, shared comments and backend Liked/Lists/Watchlist are not added in this module.
