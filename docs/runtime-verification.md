# Runtime verification

Checks performed locally on 2026-10-31 (Africa/Nairobi). Results below distinguish real Telegram checks from deterministic fixtures and prepared deployment configuration.

| Check | Result |
| --- | --- |
| Existing Go tests and streaming engine | Passed, including new synchronization tests |
| Initial paginated history, multiple new videos, repeated sync, duplicate prevention | Passed deterministic Go tests |
| Interrupted scan, saved cursor reload and continuation | Passed deterministic Go test |
| Caption edits and source-identity separation | Passed deterministic Go tests |
| Real initial Telegram synchronization | Passed: 6 unique videos, MP4 and MKV, completed initial scan |
| Real repeated recovery polling | Passed: 6 records retained without duplicates |
| Real application API and frontend route | Passed: HTTP 200, `source: telegram-sync`, completed sync status |
| Actual HTTP stream delivery | Passed: HEAD 200, exact 1,024-byte response with 206, bytes identical to private Go response, invalid range 416 |
| Go unavailable | Passed live test: stopping Go produced a clear 503 through the frontend API |
| Session/catalogue persistence across restart | Passed live test: same saved session reused; 6 videos recovered without manual selection/login |
| Node API authorization, new records, range bytes, missing IDs and outage response | Passed real-HTTP fixture tests |
| Frontend polling and focus refresh | Implemented; existing live records displayed. New Telegram uploads were not sent during the test |
| Browser decoding and seeking | Verification in progress; see final report for the measured result |
| Production frontend builds | Passed public/admin builds; deployment base-path build checked separately |
| Compose syntax | Passed with placeholder environment values and no secret output |
| Docker images, container crash restart | Not verified: local Docker engine was unavailable, including after requesting Docker Desktop startup |
| VPS reboot/startup, TLS/domain, Coolify deployment and production load | Not executed; no configured VPS deployment was available in this session |
| Live new-message event burst, forced Telegram disconnect/reconnect | Not deliberately induced; deterministic new-message recovery tests pass |

No Telegram messages were posted by the agent, no fabricated catalogue records were inserted into the live source, and no source videos were retained on disk. Metadata/checkpoint snapshots are persistent; video segments remain streamed.

## Video card covers — 2026-11-02

- Extracted covers through the actual application endpoint for all six current
  Telegram videos: five MKV files and one MP4, all HTTP 200 JPEG. The saved local
  acceptance summary is `.local/qa/thumbnail-verification.json`.
- The six actual frames total 34,908 image bytes. Source reads remained bounded by
  the extractor's range budget; no source video was saved on disk.
- All 22 Node checks passed with the real FFmpeg decoder enabled, including a
  10-bit MKV, MP4, black-opening rejection, authentication, range budgets,
  retries, cancellation and existing streaming behavior.
- Public frontend production build passed. The mobile layout was inspected at
  390px: the actual frame fills the existing cover above the title; no separate
  preview remains. Screenshot: `.local/qa/mobile-actual-video-covers.png`.
- At 1440px, the five-column desktop grid retained the same card widths and image
  heights (first card approximately 243.275px × 364.913px).

The local API is running with the FFmpeg executable detected by the runtime
wrapper. Deployment images still require rebuilding on the target Docker host;
no production deployment was performed as part of this cover change.

## Module 4.1 — 2026-11-02

- Applied additive migration `202611020001_module41` to the inspected PostgreSQL database; seeded three real ETB packages. Root `.env` remained unchanged.
- 28/28 Node tests passed, zero skips, with real FFmpeg and the isolated real PostgreSQL workflow enabled. The disposable schema was removed afterward.
- Public/admin production builds passed, including the `/admin/` asset base. Prisma schema validation passed.
- After restarting Node: 7 automatically discovered unique videos, complete Go sync status preserved, all 7 real durations available, 3 DB packages, and the 1 genuine browser-qualified view persisted. No live test accounts/subscriptions/memberships were created.
- Live HTTP verification passed HEAD200, exact 1,024-byte206 matching original Go bytes, and invalid Range416. Source formats include MKV and MP4. No source video was saved.
- Actual browser playback decoded the real Verity MP4; Most Viewed and Trending subsequently put that viewed video first. Public cards expose no view totals. Longest follows measured durations.
- ETB package rendering and selected-package persistence through account navigation were inspected. Live human Telegram handoff awaits the actual contact. Live Clerk/Google/admin acceptance is deferred to Module4.2 by the user; missing credentials deny access.
- Docker image execution, production deployment and VPS reboot/crash/load/backup checks remain unverified. See [the full report](module41.md).

## Module 4.2 — 2026-11-02

Migration `202611020004_admin_management` applied; configured first owner saved in PostgreSQL. Real Clerk server credentials accepted; Google provider enabled. Thirty regression tests passed with zero skips, using disposable PostgreSQL schemas and real FFmpeg fixtures. Both production builds and Compose syntax passed. See [Module 4.2](module42.md) for the seven sections, role checks, visibility enforcement, visual QA and pending live Google/deployment acceptance.

Final Module 4.2 checks: real first-owner Google sign-in and protected dashboard succeeded; all four migration checksums matched; 7 real videos/7 durations and the existing qualified view persisted. Desktop/mobile administration UI was inspected. Isolated UI edits/hiding, manual activation and comment hiding persisted and were cleaned up. Focused concurrency/date/access checks passed after fixing lock order. No fake public account/payment/statistic records were retained.
