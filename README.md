# Stream Web — Modules 1 and 2

A Go command-line application that signs in to an existing Telegram account, finds a group or channel named `Stream Test`, and inspects message metadata to discover video files and candidate movie names.

Module 2 adds a local HTTP service that streams the selected video's actual Telegram bytes progressively and supports seeking. It reuses Module 1's authentication, saved session, source selection and message inspection. There is no media cache, full-file pre-download, database connection or public endpoint. React, Node.js, Prisma, PostgreSQL and deployment remain future work.

## Prerequisites and setup

- A current Go toolchain compatible with `go.mod` (Go 1.25 or later; dependencies may require a newer toolchain, which Go can select automatically).
- A Telegram account that already belongs to the intended private group/channel and can read its history.
- Your Telegram application API ID and hash from [Telegram's application page](https://my.telegram.org/apps).
- Outbound access to Telegram MTProto servers. A corporate firewall or ISP may restrict this.

Run all commands from this project folder. Install Go from the [official Go downloads](https://go.dev/dl/) if `go version` is unavailable.

This workspace also has a checksum-verified portable Go 1.27.3 toolchain in the ignored `.tools` directory. To use it in PowerShell without a system installation:

```powershell
$env:Path = (Join-Path $PWD '.tools/go/bin') + ';' + $env:Path
$env:GOPATH = Join-Path $PWD '.tools/gopath'
$env:GOCACHE = Join-Path $PWD '.tools/gocache'
```

The toolchain and dependency/build caches are development tools, not video storage. They are not included in a new checkout.

The local `.env` already existed when Module 1 was created. It was not overwritten. Its required variable names are:

```dotenv
TELEGRAM_API_ID=your_numeric_api_id
TELEGRAM_API_HASH=your_32_character_hex_api_hash
# Reserved for a later module; not required or read by discovery or streaming:
DATA_BASE_URL=your_future_database_url
```

These are placeholders, not usable credentials. If setting up another checkout, create a local `.env` with your own values. Existing process environment variables take precedence over `.env`. Keep `.env` private and out of version control.

```powershell
go mod download
go test ./...
go build -o bin/stream-discover.exe ./cmd/stream-discover
.\bin\stream-discover.exe -check-config
```

On Linux/macOS, build with `go build -o bin/stream-discover ./cmd/stream-discover`, then run `./bin/stream-discover` with the same flags. You can also use `go run ./cmd/stream-discover` on any platform.

## First login and session reuse

```powershell
.\bin\stream-discover.exe -mode find
```

On first login, the CLI prompts in your terminal for your phone number with country code, the login code delivered by Telegram, and your two-step verification password if required. Input is hidden. Use an existing account; this CLI does not register new accounts. Never paste login codes or passwords into a chat or command-line flag.

The authorized session is saved to `.sessions/telegram.session.json` and reused on later runs. This is Telegram account authentication data, **not a video cache**. The CLI restricts the session directory and files to the current Windows user using an ACL, or to modes `0700`/`0600` on Unix. It fails if permissions cannot be applied. Run only one CLI instance against a session file at a time.

Use `-session .sessions/another.session.json` to select a different session file. Always use a dedicated private directory: its permissions will be restricted. Custom session locations must also be excluded from version control. For a revoked, expired, or corrupt session, use a fresh session filename and authenticate again. Manage/revoke unwanted sessions through the official Telegram app.

The CLI prints `Telegram authentication: successful` only after Telegram confirms authorization. A successful `find` also performs a real history request to confirm access.

## Commands

Find the source and verify history access:

```powershell
.\bin\stream-discover.exe -mode find
```

Inspect up to 100 recent messages and show discovered videos and other media:

```powershell
.\bin\stream-discover.exe -max 100 -page-size 50
```

List recent messages, including text and service messages:

```powershell
.\bin\stream-discover.exe -mode list -max 20 -page-size 20
```

Scan more history without loading it all into memory:

```powershell
.\bin\stream-discover.exe -max 1000 -page-size 100 -timeout 10m
```

Continue from the numeric offset printed at the end of the previous scan:

```powershell
# Replace 12345 with the actual continuation offset from your run.
.\bin\stream-discover.exe -offset-id 12345 -max 100 -page-size 50
```

Inspect one message in the selected source:

```powershell
# Replace 12345 with an actual message ID reported by discovery.
.\bin\stream-discover.exe -mode inspect -message-id 12345
```

| Flag | Default | Purpose |
| --- | --- | --- |
| `-source` | `Stream Test` | Exact display name, ignoring case and surrounding spaces. |
| `-mode` | `discover` | `discover`, `list`, `inspect`, `find`, or `serve`. |
| `-page-size` | `50` | History request size, from 1 to 100. |
| `-max` | `100` | Maximum messages inspected, including non-video messages. |
| `-offset-id` | `0` | Exclusive message ID boundary; zero starts at newest. |
| `-message-id` | `0` | Required in `inspect` and `serve` modes; scoped to the selected source. |
| `-session` | `.sessions/telegram.session.json` | Session file in a dedicated private directory. |
| `-env` | `.env` | Dotenv file path. |
| `-timeout` | `5m` | Discovery or server initialization deadline, including authentication. |
| `-check-config` | `false` | Validate configuration without network access. |
| `-help` | | Show CLI help. |

Both ordinary and archived dialogs are searched. No username, source ID, message ID, or access hash is hardcoded. If multiple groups/channels have the same name, choose the listed source number explicitly. Identifying output includes the source name, peer type, and numeric ID, never access hashes or session data.

## Module 2: local video streaming

**Development only: website-level playback authorization is not implemented. Do not publish this endpoint through a VPS port, tunnel or reverse proxy.** The service accepts only numeric loopback listen addresses. Requests must use the exact configured host and port; foreign browser origins are rejected. A message ID is not authentication.

Discover or inspect a video first. Message `3` was discovered in the local `Stream Test` source; replace it with the message ID from your own discovery when selecting another video:

```powershell
.\bin\stream-discover.exe -mode inspect -message-id 3
.\bin\stream-discover.exe -mode serve -message-id 3
```

The service prints `http://127.0.0.1:8080/media/stream/3`. Keep that terminal open, then issue requests from a second terminal. Stop the service with Ctrl+C before running another CLI command against the same session.

```powershell
# HEAD: full file metadata, no video bytes or response body.
curl.exe -I http://127.0.0.1:8080/media/stream/3

# Exactly 1,024 response bytes; NUL discards the body without saving media.
curl.exe --fail -sS -D - -H "Range: bytes=0-1023" -o NUL -w "received=%{size_download}\n" http://127.0.0.1:8080/media/stream/3

# Ordinary GET: starts a 200 response; deliberately cancel after three seconds.
curl.exe --max-time 3 -D - -o NUL http://127.0.0.1:8080/media/stream/3
```

The last command normally exits with curl timeout code 28 because the video is large. Cancellation stops further upstream work as the disconnect reaches the server. A GET consumed to completion transfers the whole file progressively; it never requires downloading it before the response starts. On Unix use `curl` and `/dev/null` instead of `curl.exe` and `NUL`.

To repeat the bounded live byte comparison, stop any running service and run:

```powershell
.\bin\stream-discover.exe -mode serve -message-id 3 -verify-stream
```

This starts the service, checks HEAD, five small ranges and an unsatisfiable range, then exits. It compares response bodies against separate precise Telegram reads, including both a configured chunk boundary and a 1 MiB boundary. It retains no media files. It requires the existing authorized Telegram session, unlike ordinary unit tests.

For playback, open the printed URL using VLC's **Media > Open Network Stream**, then seek to another time. The service passes through the original container and codecs without transcoding. The tested file is MKV with HEVC video; a successful VLC check does not establish browser compatibility.

| Streaming flag | Default | Purpose |
| --- | --- | --- |
| `-listen` | `127.0.0.1:8080` | Numeric loopback only; IPv6 loopback is also accepted. Use this exact host in requests. |
| `-chunk-size` | `262144` | 256 KiB per Telegram part; power of two from 4 KiB through 1 MiB. |
| `-concurrency` | `2` | Maximum active requests, from 1 to 8; excess requests receive 503. |
| `-part-timeout` | `20s` | Deadline for each part including retries, and each request's metadata lookup. |
| `-request-timeout` | `30m` | Maximum lifetime of one HTTP request. |
| `-verify-stream` | `false` | Run bounded live integration checks and exit; requires `-mode serve`. |

The server also limits headers to 8 KiB, header reads to 5 seconds, request reads to 10 seconds, idle connections to 60 seconds and individual response writes to 15 seconds. A player that keeps a single GET open for more than 30 minutes will hit the default request deadline. For a longer local playback check, explicitly raise it, for example `-request-timeout 3h`. This does not change the memory bound.

### HTTP behavior and selection

- GET without Range returns 200; valid single byte ranges return 206 with exact inclusive lengths and `Content-Range`.
- Closed (`bytes=100-199`), open-ended (`bytes=100-`) and suffix (`bytes=-1024`) ranges are supported. A valid end beyond EOF is clamped. A suffix larger than the file selects the entire file.
- Malformed, reversed, unsatisfiable and multiple ranges return 416 with `Content-Range: bytes */TOTAL_SIZE`. Multipart responses are not implemented.
- HEAD returns 200 and full-file headers without retrieving file parts or sending a body. Range is ignored on HEAD. Matching ETag `If-Range` is supported; a mismatch falls back to a full GET.
- The real positive file size is required. Missing size or required Telegram identifiers produces 422. A missing MIME type uses `application/octet-stream`, without guessing a video codec. Generic documents receive 415.
- The HTTP route exposes only the CLI-selected message within the CLI-selected source. Other IDs return 404. Query parameters, request bodies and browser-supplied Telegram identifiers are not accepted.
- The message is re-resolved for every request. A replaced document or changed size produces 409 and requires restarting with an explicit selection. Missing/inaccessible media produces 404.
- The first part is fetched before success headers are sent. Upstream failures become error responses (normally 502, 503 for rate limiting, 504 for deadlines). Failures after streaming starts close/reset the response; no second status or error text is appended to video bytes.

### Telegram retrieval and resource bounds

The installed gotd version is `v0.163.0`. Retrieval uses `UploadGetFile` with `InputDocumentFileLocation` populated from the original message's document ID, access hash and file reference, and an empty thumbnail selector. Telegram's [file-download specification](https://core.telegram.org/api/files#downloading-files) requires non-precise offsets and limits divisible by 4 KiB, a limit that divides 1 MiB, and no request crossing a 1 MiB window. The separate verification path uses precise 1 KiB reads.

For configured chunk size `C`, the service aligns the HTTP position down to `floor(position / C) * C`, fetches that part, and writes only its intersection with the requested inclusive range. It repeats one part at a time. For example, `bytes=262131-262175` crosses the default 256 KiB boundary and returns exactly 45 bytes from two aligned requests. Only the actual final file part may be shorter than the requested Telegram limit; unexpected short reads are retried once and then fail.

Each active request holds one media part at a time, with no queue of prefetched parts and no retained video cache. Default active payload buffers total approximately `2 * 256 KiB`, plus MTProto/HTTP buffers, transient decoder allocations and Go runtime overhead. This is a bound on application buffering, not a fixed process-RSS ceiling; it does not grow with movie size or requested range length. Cancellation propagates through metadata lookup, pool waits, retries and file requests. An already transmitted Telegram request cannot be recalled, but the service does not keep fetching abandoned ranges.

The existing authorized client supplies shared connection pools for the required data centers. Pool creation does not hold a global map lock during network calls. Authorization transfers are serialized per client as required by gotd. A part allows at most three attempts within its deadline: one reference refresh, one DC migration and at most one transient/short-read retry, subject to that total attempt cap. A stale reference is refreshed through the same source/message and checked against the original document and size. Flood limits fail immediately; wait before retrying manually.

Only origin-DC retrieval is implemented (`cdn_supported=false`). An unexpected CDN redirect fails explicitly; CDN decryption is not implemented. There is no speculative prefetch, throughput guarantee, transcoding or persistent media storage. Authentication/session files and development tool caches are unrelated to video caching.

If a reference cannot be refreshed, re-inspect the original message and restart the service. For a missing/inaccessible message, verify source membership and that the message still exists. For timeouts or retrieval failures, check Telegram connectivity and account access; adjust the part deadline only if needed. For revoked sessions, follow the existing login/session instructions above. Raw Telegram errors, file references and access hashes are not logged.

## Output and title candidates

The output contains a source/authentication summary, a separate formatted JSON object per displayed message, and final scan counts. It is intended for terminal inspection, not as one JSON document. The inspected count is printed after traversal so it reflects messages actually processed. Partial scans are marked as incomplete on error.

Metadata includes source identity, message ID, UTC date, original text/caption, media type, filename, byte size, MIME type, document ID, and available document attributes. Missing filename/MIME fields are omitted rather than invented. Other documents, photos, audio, animations, and stickers are identified separately from videos. Discovery and inspection do not download media contents or thumbnails; only serve mode retrieves video parts.

Candidate title priority:

1. Explicit caption/text labels such as `Movie title:`, `Movie:`, `Title:`, or `Film:`.
2. The original filename with its final extension removed.
3. Filename normalization and removal of a suffix starting with a recognized release marker.

For example, `Example.Movie.2024.1080p.WEB-DL.x264.mkv` yields `Example Movie (2024)`. Original filenames and captions remain in the metadata. Every candidate includes its derivation source and `uncertain: true`. Unlabelled prose is not assumed to be a title; without an explicit label or filename, the title is unavailable. Episode markers and words such as `Trailer` are preserved. A video may be a movie, episode, trailer, clip, or unrelated content. No title is verified against an external database.

## Troubleshooting and limits

- Missing/invalid configuration produces an error naming the variable, never its secret value.
- A missing source means the account does not have a matching accessible group/channel dialog; confirm membership and display name.
- An inaccessible source or missing message may indicate revoked access, hidden history, deletion, or an incorrect selection.
- Telegram rate-limit errors stop the operation. Wait before retrying; do not repeatedly request login codes.
- Network errors stop discovery. Check MTProto reachability and retry; increasing `-timeout` may help on slow networks.
- Login requires an interactive terminal. Piped input is rejected for authentication. A background tool cannot supply your private login information.
- The CLI is read-only with respect to messages: it does not send, edit, delete, or mark messages read. Authentication creates a Telegram session.
- Output contains private source metadata. Avoid redirecting it into tracked files or sharing it unintentionally.
- Pagination keeps one page in memory. Continuation IDs apply only to the same selected source. End-of-history is confirmed by an empty page; a full final page may print a continuation that subsequently returns no messages.
- Candidate cleanup is heuristic. Review the preserved filename/caption whenever a title looks wrong.

## Files and dependencies

| Location | Responsibility |
| --- | --- |
| `cmd/stream-discover/main.go` | CLI flags, workflow, source selection, terminal output. |
| `cmd/stream-discover/serve.go` | Local HTTP server startup, verification mode and shutdown. |
| `internal/config/` | Dotenv loading and credential validation. |
| `internal/telegram/` | Interactive authentication, protected session storage, safe errors and serialized authorization transfers. |
| `internal/discovery/` | Dialog lookup, bounded history pagination, message inspection. |
| `internal/media/` | Classification, metadata extraction, candidate titles. |
| `internal/streaming/` | Range parsing, HTTP handling, incremental reads, Telegram/DC pools, live verification and deterministic tests. |
| `go.mod`, `go.sum` | Pinned dependencies and checksums. |
| `.gitignore` | Local secrets, sessions, build products, and development tooling exclusions. |

Direct libraries: [gotd/td](https://github.com/gotd/td) for MTProto, [godotenv](https://github.com/joho/godotenv) for `.env`, and Go's `x/term` / `x/sys` packages for hidden input and Windows permissions. Authentication follows the [gotd authentication API](https://gotd.dev/docs/authentication/user/); dialog traversal uses its [query helpers](https://gotd.dev/docs/helpers/query-iterators/).

Module 2 adds `serve.go`, `internal/streaming/`, and `internal/telegram/transfer.go` with its tests. It modifies `main.go`, adds a missing-message sentinel to `internal/discovery/history.go`, and updates this README. The existing login/session implementation, dependencies, `.env` and `.gitignore` are preserved. No new dependency was required.

## Verification

```powershell
gofmt -w cmd internal
go test ./...
go vet ./...
go build -o bin/stream-discover.exe ./cmd/stream-discover
```

Tests cover configuration validation, secret-safe parse errors, filename extension removal, candidate cleanup, video/document classification, missing fields, metadata preservation, source-name matching, pagination limits/continuation/empty pages/errors, precise message selection, and protected session persistence.

Streaming tests use fake providers and Telegram responses: range parsing and inclusive lengths, chunk/window boundaries, exact slicing, headers/statuses, HEAD with no file reads, unknown size/MIME, unsupported media, cancellation, concurrency, failed first/later parts, short reads, reference refresh, migration, retry caps, deadlines, document replacement, CDN rejection and pool/authorization-transfer concurrency. Ordinary tests require no Telegram credentials; HTTP tests bind ephemeral loopback ports.

Verified on Windows with Go 1.27.3:

- `gofmt`: clean.
- `go mod verify`: all modules verified.
- `go test -p 1 ./...`: all tests passed under the normal Windows account.
- `go vet ./...`: passed.
- `go build -o bin/stream-discover.exe ./cmd/stream-discover`: passed.
- `bin/stream-discover.exe -check-config`: passed using the existing local configuration, without displaying its values.

The session test initially failed inside the restricted execution sandbox after applying the owner-only Windows ACL. It passed outside that sandbox. Run the CLI and session tests under your normal Windows account; do not weaken session permissions to accommodate a sandbox.

The user subsequently completed interactive authentication and confirmed discovery and saved-session reuse. Module 1 found one video in two accessible messages in `Stream Test`, with candidate title `The Shawshank Redemption (1994)` and message ID `3`. The existing tests and build passed before Module 2 changes.

Live Module 2 verification on 2026-10-30 reused that session and resolved the same video (1,957,269,223 bytes, `video/x-matroska`). HEAD returned the full size with no body. These responses all returned 206 with correct lengths and matched separate precise Telegram reads byte for byte:

| Requested bytes | Response length | Check |
| --- | --- | --- |
| `0-1023` | 1,024 | File beginning |
| `262131-262175` | 45 | Default 256 KiB part boundary |
| `1048563-1048607` | 45 | 1 MiB Telegram window boundary |
| `978634598-978634642` | 45 | File midpoint |
| `1957269190-1957269222` | 33 | Final short part |

An unsatisfiable request returned 416 with the correct total size. The check completed successfully without a full-file download or saved media.

VLC 3.0.21 also opened the real stream, sought to 600 seconds using HTTP offset `125392868`, received 206, started its HEVC decoder and reported a first picture. A bounded check configured to stop at 605 seconds exited normally. With the default 256 KiB parts, VLC reported 5,073 ms of buffered media in 610 ms. The test used hidden dummy video/audio output; it verifies seek and decode, not visible playback, audio quality or a full movie. VLC logged one AAC zero-sample warning. Abandoned player requests were canceled at the server. Text-only diagnostic logs are ignored under `.tools/`.

Browser playback, sustained full-movie playback, public deployment and production load are unverified. Reference expiry, forced DC migration, unexpected CDN redirects and network faults were exercised with mocks, not deliberately induced against the live account. The service was stopped after verification.

## Planned stack for later modules

| Technology | Responsibility | Why we plan to use it |
| --- | --- | --- |
| React | Frontend and video player | Planned frontend technology. |
| Node.js | Main application API and access control | Own application logic and authorization. |
| Prisma | Database access | Planned database access layer. |
| PostgreSQL | Catalogue, users, permissions, metadata | One main application database. |
| Go + gotd | Telegram connection and media retrieval | Implemented discovery and local MTProto streaming service. |
| HTTP Range | Deliver requested portions of video | Implemented seeking and partial playback. |
| Reverse proxy + HTTPS | Public routing and secure transport | Planned public application access. |

**Avoid VPS disk caching if a workable alternative exists. Disk caching is not selected or required.** Module 2 fetches requested Telegram ranges directly using bounded RAM buffers and does not cache media. Seeking and byte correctness have been tested; suitability for sustained playback, repeated reads, larger concurrency and Telegram request limits still needs evaluation. Any future reverse proxy must also be checked for temporary-file buffering. Discuss any proposal to introduce video disk caching with the user first.

This preference concerns video storage. The local Telegram session file stores authentication data only. Stop after Module 2 until the user requests further implementation.

