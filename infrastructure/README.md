# Infrastructure

Root `compose.yaml` manages production Go, Node, public/admin static builds and the HTTPS reverse proxy. Only proxy ports are published. Caddy permits anonymous browsing; private gateway tokens and backend Clerk/database authorization protect privileged requests. Source video chunks are streamed rather than persisted on VPS disk.

The API image installs FFmpeg/OpenSSL and generates Prisma. Startup applies additive migrations, preserves existing package edits and bootstraps the initial owner once from `EMAIL`/`USER_NAME`. Later administrator approvals and settings are stored in PostgreSQL. Server-side Clerk keys use `CLERK_PUBLIC_KEY`/`CLERK_SECRET_KEY`; secrets are not compiled into frontend assets. The development-only QA entry points are excluded from the image context.

See [Module 4.2](../docs/module42.md), [Hostinger/Coolify operations](../docs/automatic-streaming.md) and [verification](../docs/runtime-verification.md). Compose syntax and frontend builds were checked locally. Container execution, target TLS/domain, crash/reboot recovery, load and restore acceptance still require the real deployment host; no remote deployment is claimed.
