# Account-owned profile refinement — 2026-11-02

Guests now see only Log in and Sign up in the profile area. `/me`, `/me/liked`, `/me/watched`, `/me/membership` and `/saved` never display another account's profile or device-local collections when signed out. Session loading has its own state so the old profile cannot flash while authentication is checked.

Signed-in identity uses the real user record: username, optional database display name and actual account creation month. Edit profile saves the display name to that account; it cannot change identity by submitting a different user ID or username. The former device-only profile implementation is retained in `ProfileDesignLegacy.jsx` and is not rendered.

Watched, Liked and Watchlist counts come from authenticated PostgreSQL records. There are no fabricated statistics. Liked and saved-video mutations are explicit, idempotent, CSRF-protected and scoped to the server session user. The player now has a real Like button; existing bookmark buttons save to the signed-in account. Guest Like/Save entry points lead to login. The previous device bookmarks are preserved but are not silently imported into any account.

Watched records qualify through actual player progress using the existing 30-second/short-video qualification rules. A separate per-account history ensures a user who watched anonymously and later signs in can have that video in their history without adding a duplicate public view. Existing authenticated qualified views are backfilled into account history. Repeated watches do not inflate the number of distinct watched videos. The profile's watched and liked pages use authenticated server-side catalogue filtering/pagination; private queries cannot choose another user ID.

Membership uses the user's actual database membership, activation and expiration records. Existing membership request/history views remain connected. No membership dates or active packages are invented. Logout clears the account collection state; local resume keys are also separated by user (or guest) to prevent sharing another account's resume banner on the same browser. Resume positions remain device-local within that account; cross-device resume synchronization is not added here.

Applied additive migrations:

- `202611020002_account_library`: optional user display name; `hh_video_likes` and `hh_saved_videos`, unique by account/video; user-view lookup index.
- `202611020003_account_watched`: `hh_watched_videos`, account/video uniqueness and last-watch index; backfill only from existing authenticated qualified view records.

Added API routes:

- `POST /api/me/profile` with `{displayName}`;
- `GET /api/me/library` for the signed-in user's counts, like/save selections and current membership;
- `GET /api/me/videos?kind=watched|liked|saved` with existing catalogue sorting/search/pagination;
- `POST /api/me/videos/:id/liked` and `/saved` with `{selected:boolean}`.

Migration tooling now uses a direct session connection. The existing `DATA_BASE_URL` stays unchanged for pooled app traffic. For Neon, the migration configuration derives its documented direct host by removing `-pooler`; other providers remain unchanged, with optional `DATA_BASE_DIRECT_URL` override. This follows [Neon's Prisma guidance](https://github.com/neondatabase/website/blob/main/content/docs/guides/prisma.md). A stale idle advisory-lock connection from an earlier pooled migration was identified, checked for no active transaction/unfinished migration, and closed once. No database records were removed to resolve it.

Validation: all 28 existing/expanded regression tests passed with PostgreSQL and FFmpeg enabled; the additional migration endpoint configuration test passed (29 total). Database tests use disposable schemas and check separate users, guest rejection, CSRF, profile persistence, like/save idempotency and ownership, watch history and the anonymous-to-account deduplication edge case. Public/admin production builds passed. The guest page and direct private links were inspected in the running app; signed-in profile/edit/collection behavior was checked using an isolated database and temporary accounts. Real application accounts/payments were not created for visual testing. Clerk setup remains deferred to Module 4.2 as previously agreed.
