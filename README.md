# Stream Web — Module 1

A Go command-line application that signs in to an existing Telegram account, finds a group or channel named `Stream Test`, and inspects message metadata to discover video files and candidate movie names.

Only Module 1 is implemented. React, Node.js, Prisma, PostgreSQL, streaming, media downloads, caching, and deployment are future work. No database connection is made, and no HTTP server is started.

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
# Reserved for a later module; not required or read by discovery:
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
| `-mode` | `discover` | `discover`, `list`, `inspect`, or `find`. |
| `-page-size` | `50` | History request size, from 1 to 100. |
| `-max` | `100` | Maximum messages inspected, including non-video messages. |
| `-offset-id` | `0` | Exclusive message ID boundary; zero starts at newest. |
| `-message-id` | `0` | Required in `inspect` mode. |
| `-session` | `.sessions/telegram.session.json` | Session file in a dedicated private directory. |
| `-env` | `.env` | Dotenv file path. |
| `-timeout` | `5m` | Overall operation deadline, including authentication. |
| `-check-config` | `false` | Validate configuration without network access. |
| `-help` | | Show CLI help. |

Both ordinary and archived dialogs are searched. No username, source ID, message ID, or access hash is hardcoded. If multiple groups/channels have the same name, choose the listed source number explicitly. Identifying output includes the source name, peer type, and numeric ID, never access hashes or session data.

## Output and title candidates

The output contains a source/authentication summary, a separate formatted JSON object per displayed message, and final scan counts. It is intended for terminal inspection, not as one JSON document. The inspected count is printed after traversal so it reflects messages actually processed. Partial scans are marked as incomplete on error.

Metadata includes source identity, message ID, UTC date, original text/caption, media type, filename, byte size, MIME type, document ID, and available document attributes. Missing filename/MIME fields are omitted rather than invented. Other documents, photos, audio, animations, and stickers are identified separately from videos. No media contents or thumbnails are downloaded.

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
| `internal/config/` | Dotenv loading and credential validation. |
| `internal/telegram/` | Interactive authentication, protected session storage, safe error descriptions. |
| `internal/discovery/` | Dialog lookup, bounded history pagination, message inspection. |
| `internal/media/` | Classification, metadata extraction, candidate titles. |
| `go.mod`, `go.sum` | Pinned dependencies and checksums. |
| `.gitignore` | Local secrets, sessions, build products, and development tooling exclusions. |

Direct libraries: [gotd/td](https://github.com/gotd/td) for MTProto, [godotenv](https://github.com/joho/godotenv) for `.env`, and Go's `x/term` / `x/sys` packages for hidden input and Windows permissions. Authentication follows the [gotd authentication API](https://gotd.dev/docs/authentication/user/); dialog traversal uses its [query helpers](https://gotd.dev/docs/helpers/query-iterators/).

## Verification

```powershell
gofmt -w cmd internal
go test ./...
go build -o bin/stream-discover.exe ./cmd/stream-discover
```

Tests cover configuration validation, secret-safe parse errors, filename extension removal, candidate cleanup, video/document classification, missing fields, metadata preservation, source-name matching, pagination limits/continuation/empty pages/errors, precise message selection, and protected session persistence.

Verified on Windows with Go 1.27.3:

- `gofmt`: clean.
- `go mod verify`: all modules verified.
- `go test -p 1 ./...`: all tests passed under the normal Windows account.
- `go build -o bin/stream-discover.exe ./cmd/stream-discover`: passed.
- `bin/stream-discover.exe -check-config`: passed using the existing local configuration, without displaying its values.

The session test initially failed inside the restricted execution sandbox after applying the owner-only Windows ACL. It passed outside that sandbox. Run the CLI and session tests under your normal Windows account; do not weaken session permissions to accommodate a sandbox.

A real connection attempt with `-mode find -timeout 30s` reached the authentication flow and stopped with `authentication requires an interactive terminal`. **Account authentication, access to Stream Test, and actual message discovery have not yet been verified.** No movie names or message counts in this document represent live results.

To finish the integration check, open PowerShell in this project folder and run:

```powershell
.\bin\stream-discover.exe -max 100 -page-size 50
```

Enter your phone, login code, and optional two-step password only in that terminal. Select the correct source if several match. Confirm that authentication succeeds and real media metadata appears. Run the command a second time to confirm session reuse. The executable is already built; these steps do not require a system Go installation.

## Planned stack for later modules

| Technology | Responsibility | Why we plan to use it |
| --- | --- | --- |
| React | Frontend and video player | Planned frontend technology. |
| Node.js | Main application API and access control | Own application logic and authorization. |
| Prisma | Database access | Planned database access layer. |
| PostgreSQL | Catalogue, users, permissions, metadata | One main application database. |
| Go + gotd | Telegram connection and media retrieval | Dedicated MTProto service; discovery is implemented first. |
| HTTP Range | Deliver requested portions of video | Planned seeking and partial playback. |
| Reverse proxy + HTTPS | Public routing and secure transport | Planned public application access. |

**Avoid VPS disk caching if a workable alternative exists. Disk caching is not selected or required.** Future design work should evaluate fetching requested Telegram ranges directly and using small bounded RAM buffers. Their suitability for seeking, repeated reads, concurrent users, and Telegram request limits still needs validation. Review reverse-proxy temporary-file behavior too. Discuss any proposal to introduce video disk caching with the user first.

This preference concerns video storage. The local Telegram session file in Module 1 stores authentication data only. Stop after Module 1 until the user requests further implementation.

