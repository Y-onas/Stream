# Habeshan HUB application API

The Node API uses Prisma/PostgreSQL for accounts, metadata, qualified views, memberships, comments, platform settings and append-only administrator audit history. It reuses the existing authenticated Go catalogue and original HTTP Range service; it does not create Telegram clients or store video chunks on disk.

Run `npm.cmd run db:generate`, `npm.cmd run db:migrate`, `node scripts/playback-keys.mjs`, then `npm.cmd run runtime:api` from the repository root for development. The production image performs additive migrations and idempotent seeding before listening. Root `DATA_BASE_URL` is preserved; direct migration connections are separate from pooled application queries.

Administrator Google authentication uses Clerk plus the active approved email stored in `hh_administrators`. `EMAIL`/`USER_NAME` bootstrap the first owner once. Later approvals and platform settings are managed in the protected admin application. No public administrator registration or environment allowlist grants access.

Catalogue, metadata and media requests enforce database publication/availability/access settings. Database outages fail closed; hidden media cannot fall back to an unfiltered Go catalogue. Liveness is `/livez`; dependency readiness is `/healthz`.

Module 4.3 adds opaque public IDs, per-video VIP/FREE policy and path-scoped RS256 playback authorization with renewal and active connection leases. Node holds the private key; the private Go service verifies it and introspects current access before returning media. See [Module 4.3 and deployment limits](../../docs/module43.md) for current stream endpoints and expiry behaviour. The legacy global streaming-access field no longer overrides per-video policy.

See [Module 4.2](../../docs/module42.md), [API contracts](../../docs/api/contracts.md), [operations](../../docs/automatic-streaming.md) and [verification history](../../docs/runtime-verification.md). The old local adapter remains for historical fixtures, outside active runtime traffic.
