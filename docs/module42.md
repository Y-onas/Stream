# Module 4.2 — Administration, platform controls and analytics

Implemented on 2026-11-02 as an extension of Module 4.1. The existing React applications, Node/Prisma/PostgreSQL service, Go/gotd discovery/session/checkpoint, qualified-view tracking and original HTTP Range path are reused. No second Telegram client, video disk cache, movie metadata service, bot or automatic payment collector was introduced.

## Administrator sign-in and first owner

The exact supplied `CLERK_PUBLIC_KEY`, `CLERK_SECRET_KEY`, `EMAIL` and `USER_NAME` names are supported. Root `.env` was preserved, and values were not printed. `CLERK_PUBLISHABLE_KEY` remains a compatibility alias for the public key. Only the publishable key is returned to the admin frontend; email bootstrap values, server keys and database credentials are never public settings.

The migration/startup command creates the **first owner only** from `EMAIL` and `USER_NAME`. Email is normalized and saved to `hh_administrators`. A persistent bootstrap timestamp plus a transaction-scoped database lock prevents additional environment-driven administrators, including concurrent startup. Changing `EMAIL` later does not add or replace an administrator.

Later administrator approvals happen only through the owner-only Administrators panel. There is no public administrator registration endpoint or sign-up form. Normal public username/password accounts remain a separate system.

Google sign-in goes through Clerk. Every privileged request verifies the token signature and authorized origin, fetches the Clerk identity server-side, checks a verified Google email, and looks up the active approved email in PostgreSQL. First sign-in binds its Clerk user ID to that existing row; a different identity cannot replace the binding. Google authentication alone creates no application administrator record. Disabling an administrator blocks their next API request.

Owners manage administrator approvals, roles and platform/package settings. Administrators manage videos, users, memberships, requests, comments, analytics and audit viewing. Transactions protect the last active owner from being disabled or demoted. All access changes and first Google bindings are audited. No development authentication bypass is present in the production app.

The supplied Clerk key was accepted by the real backend API; its public environment loads, Google is enabled, and no additional sign-up fields were required. At configuration inspection time, the configured email had not signed into this Clerk project yet. The real Google login screen is available at http://127.0.0.1:5174/. The user subsequently completed the real Google sign-in; the live server linked that verified identity to the existing first-owner row, and the protected dashboard displayed the real database totals. This was verified separately from the isolated acceptance identity.

## Seven management sections

| Section | Implemented behavior |
| --- | --- |
| Video management | Paginated discovered videos, title/filename/description search, visibility and availability filters, newest/oldest/most-viewed/longest sorts, title/description overrides, publish/hide/manual-unavailable controls, real durations and internal views, authorized source IDs. Overrides survive discovery sync. No source message or media is deleted. |
| User management | Username search, active/suspended filters, creation/status/reason/admin/time details, current and historical membership, requests, recent qualified viewing and likes. Suspension revokes account sessions; restoration is audited. Passwords, hashes and session secrets are excluded. |
| Membership management | Active/expired/revoked history and search; reasoned manual activation, extension, package change and revocation; approving administrator and audit history. Manual grants use `source: MANUAL` and no payment request, and cannot masquerade as verified customer payments. |
| Comment management | Real authenticated comments on published videos; moderation search by text/username and video/status filters; hide, restore, confirmed delete, reason/admin/time and immutable original text. Public conversations refresh moderation state. No reviews or ratings. |
| Analytics | Actual PostgreSQL totals and time series, registrations, account states, published/hidden/unavailable videos, qualified day/week/month/all-time views, signed-in viewer trends, top/trending/longest videos, membership activity/distribution, request conversion. No simulated counts or chart data. |
| Platform settings | Database-backed name, default currency, reporting timezone, registration availability, maintenance/message, streaming access policy, human Telegram username/URL/display name, plus existing package names/prices/durations/enablement/order. Changes refresh in the public app without rebuilding. |
| Audit logs | Append-only PostgreSQL records across all operations, before/after values, administrator, target, timestamp and reason. Filter by administrator ID, action, entity, target ID and local date range. No UI/API for editing or deleting logs; database trigger rejects updates/deletes. |

The existing saved-request/manual Telegram proof/approval workflow remains in its own dashboard section. Additional administrators are managed in a dedicated owner-only section.

## Important behavior and boundaries

Public catalogue/metadata/comments exclude hidden, manually unavailable and source-unavailable videos. The byte gateway checks PostgreSQL visibility and access **before** reading Go media or generating a thumbnail, so knowing an old video URL does not bypass hiding. Original GET/HEAD/Range bytes, seeking, content headers and Telegram retrieval are otherwise unchanged.

Once the database controls visibility and access, a database outage fails catalogue/media access closed with a sanitized 503. The earlier Go-only fallback cannot safely enforce newly hidden records and is no longer used in the database-backed runtime. Liveness and dependency readiness stay separate. A stream already authorized and opened is not retroactively transcoded or rewritten; subsequent media requests recheck current policy. Browser container/codec compatibility remains unchanged; no transcoder was added.

Streaming defaults to PUBLIC to preserve anonymous browsing/playback. Owners may choose SIGNED_IN or MEMBERS for playback. Suspended accounts cannot use protected account features; in PUBLIC mode, anonymous content remains public. Maintenance pauses public catalogue/streaming while administrator access and public status configuration remain available.

Membership actions serialize on the user record. Duplicate manual operations reuse an idempotency key; repeated approval returns the original activation. A user with a current active membership must use Extend or Change package rather than receive overlapping activations. Extensions apply only to active memberships and add calendar months to current expiry; expired memberships require a new activation. Package changes retain the old record as revoked and create a new manual activation starting now. Existing request and original membership/package snapshots are preserved; changes have before/after audit records.

Comment deletion is a restricted tombstone: it disappears publicly and cannot be restored through the dashboard. Its original text remains in the administrative record/audit for traceability. Moderation never silently edits text.

Analytics aggregate in PostgreSQL before returning bounded results. Calendar boundaries use the configured IANA timezone; weeks start Monday. Filters include Today, Last7/30/90 days, All time and inclusive custom local dates. Long ranges use weekly/monthly/yearly buckets. Active-membership charts count the state at interval end; activations and expirations use stored lifecycle dates. Current trending and longest-catalogue tables are explicitly labeled separately from the selected report window. Counts remain private to administrators.

## Database migration

Applied additive migration `202611020004_admin_management` without reset:

- `hh_administrators`: approved canonical email, name, optional bound Clerk ID, role/status/version, creator and timestamps.
- `hh_platform_settings`: validated singleton settings, version and one-time bootstrap marker.
- `hh_comments`: author/video references, original text, moderation state/reason/administrator/time, tombstone and indexes.
- Video override, publication, manual availability and version fields.
- User suspension reason, status-change administrator and timestamp.
- Nullable membership request for explicit manual grants, activation source, version and unique operation key.
- Audit idempotency key, indexes, and a database trigger forbidding audit mutation.
- Supporting registration/activation indexes.

All existing catalogue IDs, sessions, accounts, memberships, requests, views and prior migration files are preserved. Direct migration connections are retained for Neon; normal application traffic keeps the original pooled `DATA_BASE_URL`.

## APIs

Existing account, catalogue, streaming, qualified-view and subscription routes are extended rather than replaced. New or expanded administrator routes:

- `GET /api/admin/me` — current database-approved identity/role.
- `GET /api/admin/videos` and `GET|POST /api/admin/videos/:id`.
- `GET /api/admin/users`, `GET /api/admin/users/:id`, `POST /api/admin/users/:id/status`.
- Existing `GET|POST /api/admin/subscription-requests/:id` and request search/history.
- `GET|POST /api/admin/memberships`, `GET /api/admin/memberships/:id`, `POST /api/admin/memberships/:id/change`, existing `/revoke`.
- `GET /api/admin/comments`, `POST /api/admin/comments/:id`.
- `GET /api/admin/analytics?preset=today|7d|30d|90d|all|custom&from=&to=`.
- `GET|POST /api/admin/settings`, `GET /api/admin/plans`, `POST /api/admin/plans/:id`.
- `GET|POST /api/admin/administrators`, `POST /api/admin/administrators/:id`.
- `GET /api/admin/audit-logs?adminId=&action=&targetType=&targetId=&from=&to=&offset=&limit=`.

Public additions are real `GET|POST /api/videos/:id/comments` and database-derived `/api/config`; existing package, support draft, visibility, maintenance and account-registration behavior now reads settings. There is no public administrator creation or membership-edit endpoint. Public user mutations retain session/CSRF protection; admin mutations require trusted Clerk bearer authorization, an allowed Origin, validation and rate limits.

## Verification

**30/30 regression tests passed, zero skips**, with isolated real PostgreSQL schemas and actual FFmpeg decoding enabled. The full run includes real RSA signature/origin checks and the new complete administration workflow. Fixtures and test identities do not create real payments or insert fake statistics into the live application schema.

Focused final checks also passed every date preset and inclusive custom dates, streaming denial after membership revocation, and simultaneous extension/revocation (one success, one409). Payment, status and membership operations now consistently lock the user before request/member records; safe transaction conflicts return409. Test-only control connections are refreshed for cleanup, and only read-only fixture requests retry transient dependency failures.

Acceptance covered one-time bootstrap, rejection of unapproved identities, database email approval, first identity binding, owner/staff permissions, last-owner protection, administrator disabling, hidden media/thumbnail denial, sync-preserved overrides, original partial streaming, suspension/restoration, manual grants/extensions/package changes/revocation, operation idempotency, preserved paid snapshots, comment hide/restore/confirmed delete, real SQL analytics/date validation, settings/registration/maintenance/access policy, and database-enforced audit immutability.

Both public/admin production builds passed, including `/admin/` assets; Prisma schema validation and Compose syntax passed. The live first-owner Google login and real protected dashboard were verified. All four applied migration checksums matched the source files. Seven discovered videos with measured durations and the existing real qualified view were preserved. Live streaming passed HEAD200, exact 1,024-byte206 matching Go, and invalid Range416. Desktop/mobile visual checks used an isolated signed test identity and disposable database, clearly labeled in the test browser; video edits/hiding, manual activation and comment hiding were confirmed in that database. Temporary records were removed afterward, including a leftover schema from an interrupted provider connection. The live application retained seven videos and its genuine qualified view, with no fabricated public users, memberships, requests or comments. The normal Google-only sign-in and real owner dashboard were verified separately. The test harness is excluded from normal production builds and Docker context; it does not bypass live Clerk authorization.

Commands:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run runtime:api
npm.cmd run dev:admin
npm.cmd run test:database
```

For the full suite: set `RUN_DB_TESTS=1`, `RUN_FFMPEG_TESTS=1`, and `FFMPEG_PATH` where needed, then run `node --test --test-concurrency=1 tests/*.test.mjs`.

## Remaining configuration and Module 4.3

The first real Google sign-in succeeded. Production needs the correct HTTPS domain/authorized origin/Clerk redirect configuration, normal secret and Telegram-session provisioning, and target-host deployment checks. The support contact remains unset unless the owner configures the actual human account; no contact is invented. No Telegram messages or payment screenshots were sent or collected automatically.

Docker image execution, actual Hostinger/Coolify deployment, TLS, crash/reboot behavior, load and backup restoration require the target environment and are not claimed as passed here. Future work may include external monitoring/alerts, password recovery for public accounts and larger-catalogue search/index tuning. No extra application module is required to use the implemented administration sections once the real owner signs in.

Reference: the Google button/callback uses the installed Clerk React6 [OAuth flow](https://clerk.com/docs/guides/development/custom-flows/authentication/oauth-connections); server checks use the [verified external account](https://clerk.com/docs/reference/backend/types/backend-external-account) and database approval.
