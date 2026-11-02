> Historical monorepo migration notes. For the current PostgreSQL/Prisma application architecture and membership/statistics additions, see [Module 4.1](../module41.md).

# Module 3 migration

Before changes, the root contained a working Go module with `cmd/stream-discover`, config/discovery/media/telegram/streaming packages, Go module files, a README, root `.env`, private `.sessions`, ignored `.tools`, and `bin/stream-discover.exe`. Baseline Go tests and the executable build passed before moving files.

`cmd/`, `internal/`, `go.mod`, `go.sum`, and the existing README moved intact to `services/stream-go`. The Go module name stays `streamweb`, so internal imports do not change. The root `.env`, `.sessions`, `.tools`, `bin` and Git repository stay in place. No credentials are copied into a frontend workspace. Root Node scripts run Go tests/builds in the new directory while running the executable from the root to preserve existing relative config/session paths.

The existing Module 2 URL is still `/media/stream/{selected-message-id}` on its loopback server. No Go HTTP/auth changes were necessary for integration. The development adapter maps an opaque browser video ID to the already selected message, forwards exact range headers and streams the upstream response with Node pipe backpressure. It removes browser-origin headers by constructing a fresh allowlisted upstream request, while checking the browser request's intended local origin first. It does not expose the private upstream URL in frontend bundles.

The current local metadata selection comes from the user's confirmed Module 1 discovery of message 3. It includes filename, MIME, size, timestamp and the unverified title candidate. There is no automatic Telegram catalogue synchronization. To select another real video, run discovery manually, update `.local/catalogue.json`, and restart Go with that message ID. Module 2 serves one selected message per process; the manual list should contain only the current selection until later catalogue and routing work exists.
