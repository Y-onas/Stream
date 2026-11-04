# Module 4.3 — Video access and renewable streaming

This is the historical Module 4.3 report. [Module 5](module5.md) supersedes its session limits, key-rotation support, outage policy, callback timing and subsequent security/testing results.

Implemented November 2, 2026. This extends the existing application; it reuses normal-user sessions, manual subscription approval, administrator roles/auditing, qualified-view rules, Prisma/PostgreSQL, Telegram discovery, gotd retrieval and the original exact HTTP Range handler.

## Behaviour and data

- Published FREE videos play anonymously. Published VIP videos require an active website session, an active account and a current membership. Hidden, unavailable and maintenance-blocked videos cannot stream.
- Discovery defaults new videos to VIP. Discovery updates preserve administrator classification and visibility. Changing classification does not publish a hidden video.
- Home contains VIP Trending, a separate horizontal Free carousel, then the existing VIP catalogue. Search remains separate. VIP covers are blurred for nonmembers; this is presentation, not authorization. Public metadata and thumbnail JPEGs remain browseable.
- A denied VIP Play opens the membership gate. Package selection precedes login/signup. The intended public video ID survives navigation and is persisted on the existing subscription request. Only the existing human approval workflow activates membership. The configured human Telegram support account is still required; no contact or payment success was invented.
- Migration `202611020005_playback_access` is additive. Existing private catalogue IDs and relations are retained; public APIs now use independent UUID `Video.publicId` values. Old source-based public URLs are intentionally no longer media entry points. Saved/liked/history records keep their existing database relations.
- Views record their access classification when qualified. Trending requires both a currently VIP video and a VIP-qualified view. Free-qualified views cannot later become VIP views through reclassification. Historical views remain preserved with a null classification and appear separately as legacy totals in analytics.

## Protocol

| Route | Purpose |
| --- | --- |
| `GET /api/videos?access=VIP` or `FREE` | Opaque metadata, existing sorting/pagination |
| `GET /api/videos/:publicId` | Published video/access metadata |
| `POST /api/playback/authorize` | `{videoId, position?}`; creates an authorized session |
| `POST /api/playback/:sessionId/renew` | Rechecks current policy and renews the same session |
| `POST /api/playback/:sessionId/terminate` | Revokes the session and expires its grant cookie |
| `GET/HEAD /api/playback/:sessionId/stream` | Same-origin native video stream, including Range |
| `POST /api/playback/:sessionId/heartbeat` | Existing qualified-view reporting on the authorized session |
| `POST /internal/playback/check` | Private authenticated Go-to-Node source mapping and lease check |

The older playback-creation endpoint delegates to the same policy. The older grantless `/api/videos/:id/stream` endpoint denies access. Database outages cannot fall back to an unrestricted Go stream or catalogue.

Node uses `jose` to sign RS256 JWTs. Go uses `golang-jwt/jwt/v5` with the public key, an RS256-only allowlist and required claims. Keys must match and use RSA with at least 2048 bits. The setup helper generates 3072-bit keys. Claims include `iss`, `aud`, `sub`, `iat`, `exp`, unique `jti`, exact public `vid`, playback `sid`, anonymous browser context `ctx`, `mode` (VIP/FREE) and `purpose`.

The browser receives a stable authorized stream URL and expiration, plus a path-scoped HttpOnly SameSite=Strict grant cookie (Secure in production). The grant is absent from URLs and response JSON. Node binds it to the viewer cookie and, for VIP, the exact authenticated website session. It forwards the signed grant privately in `X-Playback-Grant`; the Go service also requires the existing service bearer. Go validates the JWT and asks Node for the trusted internal catalogue mapping. Browser-supplied Telegram peers, message IDs and file references are never accepted.

Authorization is rate limited to 40 starts/minute per trusted client address and 60 renewal/termination operations/minute. Existing same-origin, CSRF, body-size and input checks remain. The limiter is per API process, not a distributed rate limiter.

## Expiry, renewal and already-open connections

The default grant lifetime is five minutes, configurable from 30 to 600 seconds. Its deadline is capped by membership expiration, website session expiration, viewer expiration and the four-hour playback-session lifetime. React renews before expiry and retains the same player source and session on success. Renewal fully rechecks current publication, availability, classification, user/session status and membership; a previously valid grant is insufficient.

Every new GET, HEAD or Range request must present an unexpired signature and pass current Node/Go session checks. A revoked or reclassified session cannot start another request even while its old JWT is cryptographically valid.

An existing HTTP response does **not** end simply because its original JWT expires. Go therefore monitors it with a hard lease timer and a private policy check every 15 seconds (configurable down to one second in the production entrypoint). An already-open connection may continue beyond its original JWT only when Node confirms that the same database session has actually renewed. Only this private active-connection check may verify an expired original signature; it cannot start a new stream. Internal thumbnail/duration probes have separate short-lived worker grants and cannot renew.

- Known membership/session/grant deadlines end the connection through the hard timer, even if a policy callback stalls.
- Revocation, suspension, logout, hidden/unavailable state or classification changes end active connections at the next policy check. Allow approximately **18 seconds** in the worst case: 15-second polling plus the three-second callback timeout, subject to normal process scheduling.
- Callback or database failure fails closed. Cancellation also sets an immediate socket write deadline, stopping stalled writes and Telegram reads. A partially sent response is closed rather than receiving appended JSON.
- The existing Go three-hour request cap still applies; the player can make another authorized Range request. The playback session itself lasts four hours and then requires a fresh start.
- Bytes already received by a browser or an intermediary cannot be recalled. A buffered section can remain playable after access is removed. This is server-side access control, not DRM or protection against recording/copying already received content.

## Proxy, media and deployment

Compose exposes only the existing HTTPS reverse proxy; Go and Node ports remain on the private runtime network. Caddy routes `/api/*` to Node, injects the gateway credential, strips inbound client `X-Playback-Grant`, and preserves ordinary cookies and Range headers. Node relays Content-Length, Content-Range, content type, ETag and 200/206/416 responses with cancellation/backpressure. Stream responses stay `no-store`; no source videos or chunks are cached on VPS disk or persisted by the browser segment cache. Existing bounded frame/duration reads receive internal worker grants. JPEG covers remain an in-memory cache.

Caddy access-log filters remove Cookie, Authorization, X-Playback-Grant and response Set-Cookie. Node logs status/timing and sanitized dependency codes, not grants. Keep signing keys, service credentials and Telegram sessions out of browser variables and log collectors.

New server configuration (placeholder values are in `.env.example`):

| Variable | Consumer / default |
| --- | --- |
| `PLAYBACK_PRIVATE_KEY_PATH` | Node only; absolute private PEM path |
| `PLAYBACK_PUBLIC_KEY_PATH` | Node and Go; matching public PEM path |
| `PLAYBACK_GRANT_TTL_SECONDS` | Node; `300` |
| `PLAYBACK_ISSUER` | Node and Go; `habeshan-hub` |
| `PLAYBACK_AUDIENCE` | Node and Go; `habeshan-stream` |
| `PLAYBACK_CHECK_URL` | Go; Compose sets `http://api:3000/internal/playback/check` |
| `PLAYBACK_CHECK_INTERVAL` | Go; `15s`, allowed production range `1s`–`15s` |

For local setup: `npm ci`, `npm run db:generate`, `npm run db:migrate`, `node scripts/playback-keys.mjs`, `npm run runtime:build`, then start runtime Go, runtime API and Vite. The key helper never overwrites an existing pair or edits `.env`. The local wrappers use ignored `.local` key paths and the existing runtime tokens.

For deployment: back up the database, provision the key pair securely, set absolute host key paths, configure the existing database/Telegram/Clerk/service credentials and HTTPS host, then rebuild and restart both API and Go together. The API entrypoint applies additive migrations. Mount the private PEM read-only into Node only and the public PEM read-only into both. Restrict host private-key permissions. Run `docker compose config --quiet`, deploy, then verify external HTTPS authorization, cookie transport, seeking, renewal and cancellation. Do not rotate only one side: provision a matching pair and coordinate restart; current implementation has no multi-key overlap/JWKS rotation.

For Linux bind mounts, make the private PEM readable by the API container's `node` UID 1000 (for example, owner 1000 with mode 0600). The public PEM can use mode 0644 so Go's UID 10001 can read it. Do not solve permission errors by making the private key world-readable. Root-owned mode-0600 keys will fail the non-root API startup.

## Verification and limits

Completed locally:

- Full Node regression suite: **68 passed, 0 failed, 4 database scenarios skipped** in that command; database suites run separately.
- Module 4.1 isolated PostgreSQL account/subscription/statistics acceptance passed through the new protocol.
- Module 4.2 isolated PostgreSQL administrator acceptance passed (2 checks, no skips), including persisted timezone changes across calendar/DST boundaries. The multi-audit settings transaction now has an explicit 15-second timeout for hosted-database latency while retaining atomicity and its version guard.
- Module 4.3 isolated PostgreSQL + actual Go verifier/Range integration: **8 passed, 0 failed, no skips**. Covers anonymous Free, denied VIP/nonmember, manual approval, intended-video persistence, exact GET/HEAD/ranges/416, altered/missing/expired/wrong-video grants, cross-browser cookie binding, hidden classification changes, separate qualified views/Trending, revocation of an already-open body, membership expiration, suspension and logout.
- Go full suite passed, including strict algorithm/issuer/audience/context checks, renewal, hard expiry, revocation and verification-outage cancellation.
- Real Telegram signed probe: HEAD 200, exact bounded ranges (including a 1 MiB boundary) 206, invalid range 416 and missing grant 401. Only requested byte ranges were read. No production user/membership or Free fixtures were created.
- Browser: denied real VIP gate rendered with no video element; package and intended-video parameters survive login navigation. In a visibly labelled isolated database, an actual small synthetic H.264 video played anonymously as Free and as an approved test VIP, sought successfully, and passed the 30-second test grant lifetime without a source/session reset or playback error. This verifies the actual browser/API/Go path, independently of Telegram source codecs.
- Public/admin production builds and Compose interpolation validation passed.
- Real FFmpeg verification passed: representative nonblank JPEG extraction from ranged MP4 and MKV fixtures, and fallback for an all-black clip.

Repeat with `npm test`, `npm run go:test`, `npm run test:database` and `npm run build`. Database acceptance creates and drops isolated schemas; it never resets the application schema. Module 4.3 automatically builds its development-only Go fixture and requires a Go toolchain. FFmpeg acceptance additionally uses `RUN_FFMPEG_TESTS=1` and `FFMPEG_PATH` if FFmpeg is not on PATH. `node scripts/qa-playback.mjs` starts the explicitly labelled disposable browser environment at `http://localhost:5183`; type `stop` in its terminal to close it and remove its test schema. Do not run that fixture in production.

The existing catalogue retained seven VIP videos and its historical view record. No real video was made Free solely for testing. Source formats/codecs still need native browser support; this module does not add transcoding. The isolated synthetic clip is test evidence, never a real catalogue poster or video.

The Docker daemon was unavailable locally, so container startup and Caddy runtime validation were not executed. No Hostinger/Coolify account or deployed routing was available to inspect. Public-port isolation, real TLS, proxy log redaction, deployment restart behaviour, sustained load and live key rotation remain deployment checks. Do not call those verified or claim production readiness from local tests alone.
