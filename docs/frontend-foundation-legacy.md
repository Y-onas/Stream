# Habeshan HUB

The current frontend uses Habeshan HUB branding and Home, Search, Premium and Profile navigation. The existing `/browse` route is retained as Search so existing links keep working. Watchlist is available from Profile. See [the incremental refinement report](docs/frontend-refinement.md) for changes and verification. Internal npm workspace names and browser-storage keys are retained for compatibility with existing scripts, saved videos and playback progress.

Module 3 adds a React public website, a separate React admin foundation and a monorepo around the existing Go Telegram discovery and streaming service. Everything runs locally. PostgreSQL, Prisma, accounts, shared comments, real trending and production deployment are future work.

The public UI follows the supplied charcoal/gold desktop and mobile references. Mobile navigation is **Home · Search · Premium · Profile**. Video-format filter controls are hidden; all supported formats remain included in normal catalogue sorting. Profile includes visual-only Liked, Membership and Contact Support entries marked Coming soon. Real activity is not invented to fill the screenshot's cards: the local catalogue currently has one confirmed video, and Trending shows its unavailable state until view-event storage exists.

## Structure

```text
apps/
  web/                     Public React app, service worker, local development adapter
    src/                   components, pages, layouts, hooks, services, utils, styles
    public/cache/          Browser range engine and IndexedDB storage
    qa/                    Development-only browser verification
  admin/                   Independent React app and foundation routes
services/
  api/                     Future Node application API: workspace and documentation
  stream-go/               Existing Module 1 and Module 2, moved intact
    cmd/stream-discover/
    internal/
    go.mod, go.sum, README.md
packages/shared/types/     Public API contract types
infrastructure/            Reserved deployment responsibilities; no deployment added
docs/
  architecture/            Migration and browser-cache design
  api/                     Catalogue, trending, comments and admin contracts
scripts/                   Root Go command wrappers
tests/                     Deterministic Node tests
.env.example               Placeholder names only
package.json               npm workspaces and development scripts
```

There are no empty placeholder files for speculative controllers or schemas. Root `.env`, `.sessions/`, `.tools/`, `bin/` and `.local/` stay outside frontend source and are ignored. The root folder can remain named `Stream web`; the npm workspace is named `phonofilm`.

## Windows setup

Install Node.js **22.12 or newer** (tested with 22.20.0) and a Go toolchain compatible with `services/stream-go/go.mod`. This workspace already has a portable Go toolchain in `.tools/go`; the wrapper selects it when present, otherwise it uses `go` from PATH. Install dependencies from this repository root:

```powershell
npm.cmd ci
npm.cmd run go:test
npm.cmd run go:build
npm.cmd test
npm.cmd run build
```

Use `npm.cmd` when PowerShell execution policy blocks `npm.ps1`. No global frontend tool installation is required. Root `.env` was preserved; never overwrite it with the example. On a new checkout, create your own `.env` using the placeholder variable names in `.env.example`: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and **`DATA_BASE_URL`**. The database value is reserved and unused. No secret uses a `VITE_` prefix.

### Run the Go service

First authenticate/discover if needed (run interactively; do not share codes):

```powershell
npm.cmd run stream -- -mode find
npm.cmd run stream -- -max 100 -page-size 50
```

Start the selected video stream in its own terminal. `3` is the confirmed local test message, not a production constant:

```powershell
npm.cmd run stream -- -mode serve -message-id 3
```

This still uses the original root session and `.env`. Only one CLI instance may use that session at a time. The root executable command also still works: `.\bin\stream-discover.exe -mode serve -message-id 3`. The Go listener stays on loopback. Full Go flags, range semantics and troubleshooting are documented in [services/stream-go/README.md](services/stream-go/README.md).

### Run the website and admin

In a second terminal:

```powershell
npm.cmd run dev
```

Open [PhonoFilm](http://127.0.0.1:5173). Use the numeric loopback URL exactly; the development adapter validates Host and Origin. In a third terminal, if needed:

```powershell
npm.cmd run dev:admin
```

Open the separate [admin foundation](http://127.0.0.1:5174). Public and admin apps build independently:

```powershell
npm.cmd run build --workspace @phonofilm/web
npm.cmd run build --workspace @phonofilm/admin
```

`npm.cmd run preview --workspace @phonofilm/web` previews the build on the same 5173 origin when the dev server is stopped. It still needs the local Go process and manual catalogue. Built frontend files alone do not provide the streaming/API adapter. Do not expose either dev/preview server publicly; playback authorization is not implemented.

## Local catalogue selection

`.local/catalogue.json` is ignored and contains only manually selected metadata from actual discovery. On a new checkout, the missing file produces a normal empty catalogue. Create it with `{ "videos": [] }`, then add a real inspected video with these operator-maintained fields:

- `id`: a stable public string (letters, digits, `_`, `-`); `messageId`: the selected positive Telegram message ID.
- `title`, `titleUnverified`, `description`, `filename`, `mimeType`, `sizeBytes`, `uploadedAt` from actual discovery or explicitly reviewed metadata.
- `durationSeconds`: measured duration, or `null` when unknown. A caption claim is not treated as verified metadata.
- `artwork`: `null`, or a `.jpg`, `.png` or `.webp` basename located in `.local/`.

The current selection is the user's confirmed `Stream Test` message 3, with its unverified title candidate and original MKV metadata. One still image was extracted for its card and kept in ignored local artwork storage. No source video was saved. No external poster or unrelated title is presented as this video's metadata.

Module 2 supports one selected message per process. Keep the local list aligned with that selection; adding another entry alone does not make Go serve another message. Discovery remains manual: this module introduces no Telegram synchronization or public debugging endpoint.

## Frontend and streaming

React calls only same-origin `/api/...` routes. `apps/web/dev/adapter.mjs` maps a public video ID to the CLI-selected Go route and pipes the response without media storage. The private upstream address exists only in server-side development tooling. CORS is disabled; exact local origins are checked. The adapter does not load `.env`, create a Telegram client or expose session files.

The individual video page includes native play/pause, seek, volume and fullscreen controls; ±10-second buttons; metadata; loading/error states; saved status; resume; and comments UI. Saved IDs and progress stay on the viewer's device. Progress stores ID, seconds, completion and last-watched time. A blocked localStorage cannot break playback; the player reports when progress cannot be saved.

Original formats pass through without transcoding. MP4, MOV, M4V and WebM can play when their codecs are supported by the viewer's browser. File extensions alone do not establish compatibility; MKV/HEVC in the current Telegram selection is unsupported by the tested in-app browser. The page displays that error honestly. The same file previously decoded and sought in VLC. No full-movie browser-playback claim is made.

## Device caching

A service worker translates native player range requests into verified 1 MiB segments stored in IndexedDB, reusing complete segments and fetching only missing ones. Stable URL + ETag + exact offsets prevent mixing versions. Shared requests avoid duplicate simultaneous reads, and stream cancellation stops abandoned work. Storage failures fall back to network playback. There is no server video cache or full-file pre-download.

In **Me**, viewers can enable/disable caching, choose a 32–512 MiB budget (128 MiB default), and clear cached video data. Older segments are evicted first. This is an online segment cache, not an offline download feature: HEAD metadata is revalidated. See [browser-cache architecture](docs/architecture/browser-cache.md) for backpressure, quota handling, concurrency, versioning and limits.

## Implemented versus awaiting backend

| Feature | Module 3 status |
| --- | --- |
| Responsive public pages and four-item bottom navigation | Implemented |
| Search, Latest, Oldest and Longest | Real operations on available metadata; unknown durations last |
| Saved videos and playback progress | Browser-local only |
| Range-stream integration | Implemented through local adapter; no new Telegram login |
| Browser video cache | Implemented with IndexedDB and a service worker |
| Trending Day/Week/Month | UI and contract ready; unavailable until real period view events exist |
| Most Viewed | Explicitly unavailable until real aggregate views exist |
| Comments | Loading/empty/unavailable/error, author/time/list and submission UI; no shared storage backend |
| Admin | Independent Overview/Content/Settings foundation; no administrative operations |
| Circles, Premium, user accounts | Explicit future states; no subscriptions/payments/authentication |
| Node API, Prisma, PostgreSQL, production security/deployment | Not implemented |

No view counts are displayed, no activity is invented, and there are no fake comments. See [API contracts](docs/api/contracts.md) and [migration decisions](docs/architecture/migration.md).

## Verification

```powershell
npm.cmd test
npm.cmd run go:test
npm.cmd run go:build
npm.cmd run build
```

Deterministic tests cover aligned/crossing/overlapping ranges, exact byte order, open/suffix/error ranges, deduplication, cancellation, changed ETags, malformed upstream responses, bounded reads, quota/unavailable storage, eviction/clear fencing, real sorting and adapter access controls. Go's existing tests exercise discovery, authentication storage and streaming without requiring account credentials.

With the frontend running, [local browser verification](http://127.0.0.1:5173/qa.html) provides explicit real-IndexedDB tests, a bounded live Telegram range-cache check and a synthetic test clip for browser controls. It is development-only and is excluded from production build output. Synthetic content is never added to the catalogue or uploaded to Telegram. It is not proof of Telegram codec compatibility.

See [Module 3 test results](docs/verification.md) for passed, failed, untested and backend-dependent behavior. Stop after Module 3; Module 4 is not started.
