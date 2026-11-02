> Current Module 4.2 updates administrator authorization to approved database emails and adds visibility, moderation and platform settings. See [the current implementation](../module42.md). Earlier foundation notes below retain their historical context.

# Frontend-facing API contracts — Module 4.1

All browser URLs are same-origin. Public video IDs are opaque; browser requests do not supply Telegram source IDs, access hashes or arbitrary media URLs. The Node gateway/private Go bearer boundary remains in place. Public browsing does not require an account.

## Catalogue and media

| Request | Behavior |
| --- | --- |
| `GET /api/videos?q=&sort=latest|oldest|most-viewed|longest&cursor=&limit=` | `{items,total,nextCursor,source:"postgresql",sync,capabilities}`; sort/search happen before pagination. Maximum 100 per page, default 24. Cursor is bound to sort/search. Latest may fall back to Go during database failure. |
| `GET /api/videos/:id` | Public metadata; duration is measured seconds or null. No public view count. |
| `GET or HEAD /api/videos/:id/stream` | Existing Go Range stream; forwards Range/If-Range and response metadata. No arbitrary query/source URL or body. |
| `GET /api/videos/:id/thumbnail` | Actual video cover: 200 JPEG, 202 pending/Retry-After or 404 fallback. HEAD does not start extraction. See [cover implementation](../video-previews.md). |
| `GET /api/trending?period=day|week|month` | `{available:true,period,items}` from qualified PG events in calendar periods, default Africa/Nairobi. Maximum 24, honestly empty without activity. |
| `POST /api/videos/:id/playback` | JSON `{position}`; creates a viewer-owned playback ticket/cookie; returns id and qualificationSeconds. |
| `POST /api/playback/:id/heartbeat` | JSON `{sequence,position,playing,seeking}`; strict sequential/server-time qualification, daily device/user deduplication. |

Most Viewed uses all-time qualified events, with latest-upload/ID tie breaks. Longest places unknown duration last. Format filter code is retained but hidden; no file-extension chips are displayed. Range and thumbnail requests do not count views. Existing comments endpoints remain explicitly unavailable; no fake shared comments are persisted.

## Accounts and membership

| Request | Behavior |
| --- | --- |
| `GET /api/config` | Currency and configured human support username/URL, or null contact. |
| `GET /api/plans` | Active database package records/prices/durations. |
| `GET /api/auth/username?username=` | Availability of that exact valid entered username, case-insensitive; rate limited. No user listing. |
| `POST /api/auth/register` | `{username,password}`; 201 account/session, 409 canonical conflict. Password 12–128 characters, username 3–30. |
| `POST /api/auth/login` | `{username,password}`; 200 session, generic 401 on mismatch, 403 suspended account. |
| `GET /api/auth/me` | User/CSRF token/current membership, or null guest session. |
| `POST /api/auth/logout` | Invalidates session; requires session and `X-CSRF-Token`. |
| `POST /api/subscription-requests` | `{planId}` with session/CSRF; saves server-priced snapshot and unique reference before returning optional human Telegram draft URL/message. Concurrent pending duplicates return the same request. |
| `GET /api/subscription-requests/:reference` | Owner-only request/handoff lookup, 404 for other users' requests. |
| `GET /api/me/membership` | Authenticated current membership, history and requests; private notes omitted. |

JSON bodies are bounded to 16 KiB. User sessions are opaque HttpOnly cookies, Secure in production, SameSite=Lax. Mutations require an allowed Origin; authenticated user mutations also require CSRF. No normal-user Google login or public user list is exposed.

## Administrator API

Except public publishable configuration, all `/api/admin/*` routes require a signed Clerk bearer token, exact administrator origin, explicit trusted Clerk user ID and Google-connected account. Missing credentials fail closed. Live Clerk configuration/acceptance is deferred to Module 4.2 per the user.

| Request | Behavior |
| --- | --- |
| `GET /api/admin/config` | Public Clerk publishable key/configured state only; no server secrets. |
| `GET /api/admin/overview` | Real user/video/member/request totals and qualified all-time/day/week/month counts. |
| `GET /api/admin/users?q=&offset=&limit=` | Paginated username search/status/membership. |
| `GET /api/admin/users/:id` | Account details, membership and request history. |
| `POST /api/admin/users/:id/status` | `{status,version,note}`; ACTIVE/SUSPENDED with audit/session revocation. |
| `GET /api/admin/subscription-requests?q=&status=&offset=&limit=` | Search reference/username, status PENDING/APPROVED/REJECTED/ALL. |
| `GET /api/admin/subscription-requests/:id` | Request, user, membership and audit history, internal notes. |
| `POST /api/admin/subscription-requests/:id` | `{action,version,note,manualPaymentConfirmed}`; verify/approve/reject/note. Approve/verify require explicit manual confirmation; reject/note require a note. Transactional, duplicate approval does not create another membership. |
| `GET /api/admin/memberships?status=&q=&offset=&limit=` | Active/expired/all history and approving administrator. |
| `POST /api/admin/memberships/:id/revoke` | `{note}`; audited revocation. |
| `GET /api/admin/videos?sort=&q=&offset=&limit=` | Real catalogue/durations plus qualified view totals, administrator only. |
| `GET /api/admin/audit-logs?offset=&limit=` | Recorded action, administrator, target, time, note and before/after. |

Admin page limits default 24/max100; UI pages use25. Version conflicts return409. Unauthenticated requests return401; disallowed origins/accounts403; invalid inputs400; unavailable dependencies503 with sanitized messages. Database errors do not expose connection strings.

## Service health and legacy code

Node `/livez` is liveness; `/healthz` checks Go readiness and application tables. Private Go `/internal/catalogue` and `/internal/videos/:id/stream` keep bearer authentication. The retired local-manual catalogue adapter and its fixtures remain in source, but production catalogue traffic comes from PostgreSQL synchronized from the original Go daemon. Current runtime additions are documented in [Module 4.1](../module41.md).

## Account profile and collections

See [account profile](../account-profile.md) for `/api/me/profile`, `/api/me/library`, `/api/me/videos?kind=watched|liked|saved`, and the `/api/me/videos/:id/liked` or `/saved` mutations. All require the authenticated account; mutations require CSRF. Counts, display names, collections and memberships are account-owned PostgreSQL records.
